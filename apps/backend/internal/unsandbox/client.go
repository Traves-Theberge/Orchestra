// Package unsandbox provides a Go client for the unsandbox.com code execution API.
//
// Authentication uses HMAC-SHA256 signing. Credentials resolve from:
//  1. Explicit arguments
//  2. UNSANDBOX_PUBLIC_KEY / UNSANDBOX_SECRET_KEY env vars
//  3. ~/.unsandbox/accounts.csv
//  4. ./accounts.csv
package unsandbox

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAPIBase = "https://api.unsandbox.com"
	UserAgent      = "orchestra-unsandbox/1.0"
)

// Client is an authenticated unsandbox API client.
type Client struct {
	APIBase   string
	PublicKey string
	SecretKey string
	HTTP      *http.Client
}

// Credentials holds API key pair.
type Credentials struct {
	PublicKey string
	SecretKey string
}

// NewClient creates a client from explicit credentials.
func NewClient(publicKey, secretKey string) *Client {
	return &Client{
		APIBase:   DefaultAPIBase,
		PublicKey: publicKey,
		SecretKey: secretKey,
		HTTP:      &http.Client{Timeout: 120 * time.Second},
	}
}

// NewClientFromEnv resolves credentials from the 4-tier priority system.
func NewClientFromEnv() (*Client, error) {
	creds, err := ResolveCredentials("", "")
	if err != nil {
		return nil, err
	}
	return NewClient(creds.PublicKey, creds.SecretKey), nil
}

// ResolveCredentials resolves credentials from 4-tier priority:
//  1. Explicit arguments
//  2. Env vars (UNSANDBOX_PUBLIC_KEY, UNSANDBOX_SECRET_KEY)
//  3. ~/.unsandbox/accounts.csv
//  4. ./accounts.csv
func ResolveCredentials(publicKey, secretKey string) (*Credentials, error) {
	if publicKey != "" && secretKey != "" {
		return &Credentials{PublicKey: publicKey, SecretKey: secretKey}, nil
	}

	envPk := os.Getenv("UNSANDBOX_PUBLIC_KEY")
	envSk := os.Getenv("UNSANDBOX_SECRET_KEY")
	if envPk != "" && envSk != "" {
		return &Credentials{PublicKey: envPk, SecretKey: envSk}, nil
	}

	accountIndex := 0
	if s := os.Getenv("UNSANDBOX_ACCOUNT"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			accountIndex = n
		}
	}

	if dir, err := unsandboxDir(); err == nil {
		if creds := loadCSV(filepath.Join(dir, "accounts.csv"), accountIndex); creds != nil {
			return creds, nil
		}
	}

	if creds := loadCSV("accounts.csv", accountIndex); creds != nil {
		return creds, nil
	}

	return nil, fmt.Errorf("unsandbox: no credentials found (set UNSANDBOX_PUBLIC_KEY/UNSANDBOX_SECRET_KEY or create ~/.unsandbox/accounts.csv)")
}

// --- API Methods ---

// ExecuteResult holds the response from code execution.
type ExecuteResult struct {
	JobID  string         `json:"job_id,omitempty"`
	Status string         `json:"status,omitempty"`
	Output string         `json:"output,omitempty"`
	Error  string         `json:"error,omitempty"`
	Raw    map[string]any `json:"-"`
}

// Execute runs code synchronously (blocks until completion).
func (c *Client) Execute(ctx context.Context, language, code string) (*ExecuteResult, error) {
	return c.ExecuteWithOpts(ctx, language, code, "")
}

// ExecuteWithOpts runs code with optional network mode.
func (c *Client) ExecuteWithOpts(ctx context.Context, language, code, network string) (*ExecuteResult, error) {
	body := map[string]any{"language": language, "code": code, "timeout": 120}
	if network != "" {
		body["network_mode"] = network
	}

	resp, err := c.request(ctx, "POST", "/execute", body)
	if err != nil {
		return nil, err
	}

	result := &ExecuteResult{Raw: resp}
	if v, ok := resp["job_id"].(string); ok {
		result.JobID = v
	}
	if v, ok := resp["status"].(string); ok {
		result.Status = v
	}
	if v, ok := resp["output"].(string); ok {
		result.Output = v
	}
	if v, ok := resp["stdout"].(string); ok && result.Output == "" {
		result.Output = v
	}
	if v, ok := resp["error"].(string); ok {
		result.Error = v
	}
	if v, ok := resp["stderr"].(string); ok && result.Error == "" {
		result.Error = v
	}

	// If job is pending/running/unknown, poll until done
	if result.JobID != "" && result.Status != "completed" && result.Status != "failed" {
		return c.WaitForJob(ctx, result.JobID)
	}

	return result, nil
}

// ExecuteAsync submits code for asynchronous execution and returns the job ID
// immediately without waiting for completion.
func (c *Client) ExecuteAsync(ctx context.Context, language, code, network string, opts ...map[string]any) (*ExecuteResult, error) {
	body := map[string]any{"language": language, "code": code}
	if network != "" {
		body["network_mode"] = network
	}
	for _, o := range opts {
		for k, v := range o {
			body[k] = v
		}
	}

	resp, err := c.request(ctx, "POST", "/execute/async", body)
	if err != nil {
		return nil, err
	}

	result := &ExecuteResult{Raw: resp}
	if v, ok := resp["job_id"].(string); ok {
		result.JobID = v
	}
	if v, ok := resp["status"].(string); ok {
		result.Status = v
	}
	return result, nil
}

// GetJob retrieves the current status and output of a job.
func (c *Client) GetJob(ctx context.Context, jobID string) (*ExecuteResult, error) {
	resp, err := c.request(ctx, "GET", "/jobs/"+jobID, nil)
	if err != nil {
		return nil, err
	}

	result := &ExecuteResult{Raw: resp, JobID: jobID}
	if v, ok := resp["status"].(string); ok {
		result.Status = v
	}
	if v, ok := resp["output"].(string); ok {
		result.Output = v
	}
	if v, ok := resp["stdout"].(string); ok && result.Output == "" {
		result.Output = v
	}
	if v, ok := resp["error"].(string); ok {
		result.Error = v
	}
	if v, ok := resp["stderr"].(string); ok && result.Error == "" {
		result.Error = v
	}
	return result, nil
}

// WaitForJob polls a job until completion with exponential backoff.
func (c *Client) WaitForJob(ctx context.Context, jobID string) (*ExecuteResult, error) {
	delays := []time.Duration{
		300 * time.Millisecond,
		450 * time.Millisecond,
		700 * time.Millisecond,
		900 * time.Millisecond,
		1600 * time.Millisecond,
		2000 * time.Millisecond,
	}

	for i := 0; ; i++ {
		resp, err := c.request(ctx, "GET", "/jobs/"+jobID, nil)
		if err != nil {
			return nil, err
		}

		status, _ := resp["status"].(string)
		if status != "pending" && status != "running" {
			result := &ExecuteResult{Raw: resp, JobID: jobID, Status: status}
			if v, ok := resp["output"].(string); ok {
				result.Output = v
			}
			if v, ok := resp["stdout"].(string); ok && result.Output == "" {
				result.Output = v
			}
			if v, ok := resp["error"].(string); ok {
				result.Error = v
			}
			if v, ok := resp["stderr"].(string); ok && result.Error == "" {
				result.Error = v
			}
			return result, nil
		}

		delay := delays[len(delays)-1]
		if i < len(delays) {
			delay = delays[i]
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(delay):
		}
	}
}

// Session represents an unsandbox session.
type Session struct {
	ID     string         `json:"id"`
	Status string         `json:"status,omitempty"`
	Raw    map[string]any `json:"-"`
}

// CreateSession creates a new execution session.
func (c *Client) CreateSession(ctx context.Context, language string, network string) (*Session, error) {
	body := map[string]string{"language": language}
	if network != "" {
		body["network_mode"] = network
	}

	resp, err := c.request(ctx, "POST", "/sessions", body)
	if err != nil {
		return nil, err
	}

	s := &Session{Raw: resp}
	if v, ok := resp["id"].(string); ok {
		s.ID = v
	}
	if v, ok := resp["session_id"].(string); ok && s.ID == "" {
		s.ID = v
	}
	if v, ok := resp["status"].(string); ok {
		s.Status = v
	}
	return s, nil
}

// ShellSessionAsync runs a command in a session and returns immediately with
// the job ID, without waiting for completion.
func (c *Client) ShellSessionAsync(ctx context.Context, sessionID, command string) (*ExecuteResult, error) {
	body := map[string]string{"language": "bash", "code": command}
	resp, err := c.request(ctx, "POST", "/sessions/"+sessionID+"/execute", body)
	if err != nil {
		return nil, err
	}

	result := &ExecuteResult{Raw: resp}
	if v, ok := resp["job_id"].(string); ok {
		result.JobID = v
	}
	if v, ok := resp["status"].(string); ok {
		result.Status = v
	}
	if v, ok := resp["output"].(string); ok {
		result.Output = v
	}
	if v, ok := resp["stdout"].(string); ok && result.Output == "" {
		result.Output = v
	}
	return result, nil
}

// ShellSession runs a command in an existing session and returns output.
func (c *Client) ShellSession(ctx context.Context, sessionID, command string) (*ExecuteResult, error) {
	body := map[string]string{"language": "bash", "code": command}
	resp, err := c.request(ctx, "POST", "/sessions/"+sessionID+"/execute", body)
	if err != nil {
		return nil, err
	}

	result := &ExecuteResult{Raw: resp}
	if v, ok := resp["output"].(string); ok {
		result.Output = v
	}
	if v, ok := resp["stdout"].(string); ok && result.Output == "" {
		result.Output = v
	}
	if v, ok := resp["error"].(string); ok {
		result.Error = v
	}
	if v, ok := resp["stderr"].(string); ok && result.Error == "" {
		result.Error = v
	}
	if v, ok := resp["status"].(string); ok {
		result.Status = v
	}
	if v, ok := resp["job_id"].(string); ok {
		result.JobID = v
	}

	// Poll if async
	if result.JobID != "" && result.Status != "completed" && result.Status != "failed" {
		return c.WaitForJob(ctx, result.JobID)
	}

	return result, nil
}

// DeleteSession destroys a session.
func (c *Client) DeleteSession(ctx context.Context, sessionID string) error {
	_, err := c.request(ctx, "DELETE", "/sessions/"+sessionID, nil)
	return err
}

// ListSessions returns all active sessions.
func (c *Client) ListSessions(ctx context.Context) ([]map[string]any, error) {
	resp, err := c.request(ctx, "GET", "/sessions", nil)
	if err != nil {
		return nil, err
	}

	if sessions, ok := resp["sessions"].([]any); ok {
		result := make([]map[string]any, 0, len(sessions))
		for _, s := range sessions {
			if m, ok := s.(map[string]any); ok {
				result = append(result, m)
			}
		}
		return result, nil
	}
	return nil, nil
}

// Service represents an unsandbox persistent service.
type Service struct {
	ID     string         `json:"id"`
	Name   string         `json:"name,omitempty"`
	Status string         `json:"status,omitempty"`
	Raw    map[string]any `json:"-"`
}

// CreateService creates a persistent service.
func (c *Client) CreateService(ctx context.Context, name string, ports []int, bootstrap string, network string) (*Service, error) {
	body := map[string]any{"name": name, "ports": ports, "bootstrap": bootstrap}
	if network != "" {
		body["network_mode"] = network
	}

	resp, err := c.request(ctx, "POST", "/services", body)
	if err != nil {
		return nil, err
	}

	svc := &Service{Raw: resp}
	if v, ok := resp["id"].(string); ok {
		svc.ID = v
	}
	if v, ok := resp["name"].(string); ok {
		svc.Name = v
	}
	if v, ok := resp["status"].(string); ok {
		svc.Status = v
	}
	return svc, nil
}

// ListServices returns all services.
func (c *Client) ListServices(ctx context.Context) ([]map[string]any, error) {
	resp, err := c.request(ctx, "GET", "/services", nil)
	if err != nil {
		return nil, err
	}

	if services, ok := resp["services"].([]any); ok {
		result := make([]map[string]any, 0, len(services))
		for _, s := range services {
			if m, ok := s.(map[string]any); ok {
				result = append(result, m)
			}
		}
		return result, nil
	}
	return nil, nil
}

// GetServiceLogs retrieves logs for a service.
func (c *Client) GetServiceLogs(ctx context.Context, serviceID string) (string, error) {
	resp, err := c.request(ctx, "GET", "/services/"+serviceID+"/logs", nil)
	if err != nil {
		return "", err
	}
	if v, ok := resp["logs"].(string); ok {
		return v, nil
	}
	return "", nil
}

// ValidateKeys checks if the current credentials are valid.
func (c *Client) ValidateKeys(ctx context.Context) (map[string]any, error) {
	return c.request(ctx, "GET", "/keys/self", nil)
}

// --- Internal ---

func (c *Client) request(ctx context.Context, method, path string, data any) (map[string]any, error) {
	apiBase := c.APIBase
	if apiBase == "" {
		apiBase = DefaultAPIBase
	}
	url := apiBase + path
	timestamp := time.Now().Unix()

	var body []byte
	if data != nil {
		var err error
		body, err = json.Marshal(data)
		if err != nil {
			return nil, fmt.Errorf("unsandbox: marshal request: %w", err)
		}
	}

	signature := signRequest(c.SecretKey, timestamp, method, path, body)

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("unsandbox: create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.PublicKey)
	req.Header.Set("X-Timestamp", strconv.FormatInt(timestamp, 10))
	req.Header.Set("X-Signature", signature)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", UserAgent)

	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 120 * time.Second}
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("unsandbox: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("unsandbox: read response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("unsandbox: HTTP %d %s %s: %s", resp.StatusCode, method, path, string(respBody))
	}

	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("unsandbox: parse response: %w", err)
	}

	return result, nil
}

func signRequest(secretKey string, timestamp int64, method, path string, body []byte) string {
	bodyStr := ""
	if body != nil {
		bodyStr = string(body)
	}
	message := fmt.Sprintf("%d:%s:%s:%s", timestamp, method, path, bodyStr)
	h := hmac.New(sha256.New, []byte(secretKey))
	h.Write([]byte(message))
	return hex.EncodeToString(h.Sum(nil))
}

func unsandboxDir() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(u.HomeDir, ".unsandbox")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	return dir, nil
}

func loadCSV(path string, accountIndex int) *Credentials {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	idx := 0
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx == accountIndex {
			parts := strings.Split(line, ",")
			if len(parts) >= 2 {
				return &Credentials{
					PublicKey: strings.TrimSpace(parts[0]),
					SecretKey: strings.TrimSpace(parts[1]),
				}
			}
		}
		idx++
	}
	return nil
}
