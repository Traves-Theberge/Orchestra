package mcp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// Server statuses reported by Probe.
const (
	StatusConnected = "connected"
	StatusDisabled  = "disabled"
	StatusFailed    = "failed"
	StatusNeedsAuth = "needs_auth"
	StatusUnknown   = "unknown"
)

// Server is an MCP server definition as listed by the API. Source is
// "orchestra" for Orchestra-managed servers and "harness" for servers read
// from a harness's own configuration.
type Server struct {
	Name      string            `json:"name"`
	Type      string            `json:"type"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env,omitempty"`
	URL       string            `json:"url,omitempty"`
	Headers   map[string]string `json:"headers,omitempty"`
	Enabled   bool              `json:"enabled"`
	Source    string            `json:"source"`
	Harness   string            `json:"harness,omitempty"`
	Status    string            `json:"status"`
	Error     string            `json:"error,omitempty"`
	CheckedAt string            `json:"checked_at,omitempty"`
}

// SplitCommandLine splits a legacy shell command line into words, honoring
// single/double quotes and backslash escapes.
func SplitCommandLine(line string) []string {
	var out []string
	var cur strings.Builder
	quote := rune(0)
	escaped, started := false, false
	for _, ch := range line {
		switch {
		case escaped:
			cur.WriteRune(ch)
			escaped = false
		case ch == '\\' && quote != '\'':
			escaped, started = true, true
		case quote != 0:
			if ch == quote {
				quote = 0
			} else {
				cur.WriteRune(ch)
			}
		case ch == '\'' || ch == '"':
			quote, started = ch, true
		case ch == ' ' || ch == '\t' || ch == '\n':
			if started {
				out = append(out, cur.String())
				cur.Reset()
				started = false
			}
		default:
			cur.WriteRune(ch)
			started = true
		}
	}
	if started {
		out = append(out, cur.String())
	}
	return out
}

func fromRecord(r db.MCPServerRecord) Server {
	s := Server{Name: r.Name, Type: r.Type, Command: r.Command, Args: r.Args, Env: r.Env, URL: r.URL, Headers: r.Headers, Enabled: r.Enabled, Source: "orchestra", Status: StatusUnknown}
	if s.Type == "" {
		s.Type = "local"
	}
	if s.Type == "local" && len(s.Args) == 0 && strings.ContainsAny(s.Command, " \t") {
		words := SplitCommandLine(s.Command)
		if len(words) > 0 {
			s.Command, s.Args = words[0], words[1:]
		}
	}
	if s.Args == nil {
		s.Args = []string{}
	}
	return s
}

// LoadOrchestraServers merges the mcp_servers table with name=command
// entries from ORCHESTRA_MCP_SERVERS (the table wins on name collisions).
func LoadOrchestraServers(ctx context.Context, database *db.DB, env map[string]string) ([]Server, error) {
	byName := map[string]Server{}
	for name, command := range env {
		if strings.TrimSpace(name) == "" || strings.TrimSpace(command) == "" {
			continue
		}
		byName[name] = fromRecord(db.MCPServerRecord{Name: name, Command: command, Type: "local", Enabled: true})
	}
	if database != nil {
		records, err := database.ListMCPServers(ctx)
		if err != nil {
			return nil, err
		}
		for _, r := range records {
			byName[r.Name] = fromRecord(r)
		}
	}
	out := make([]Server, 0, len(byName))
	for _, s := range byName {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// RunSpecs returns the enabled servers to pass to a harness run. A non-empty
// allow list (an agent's mcp_servers) narrows the set; "*" keeps all.
func RunSpecs(servers []Server, allow []string) []agents.MCPServerSpec {
	allowed := map[string]bool{}
	for _, name := range allow {
		allowed[name] = true
	}
	narrow := len(allow) > 0 && !allowed["*"]
	out := []agents.MCPServerSpec{}
	for _, s := range servers {
		if !s.Enabled || narrow && !allowed[s.Name] || !agents.ValidMCPServerName(s.Name) {
			continue
		}
		spec := agents.MCPServerSpec{Name: s.Name, Type: s.Type, Command: s.Command, Args: append([]string(nil), s.Args...), Env: s.Env, URL: s.URL, Headers: s.Headers}
		if spec.Type == "remote" {
			spec.Command, spec.Args = "", nil
		}
		out = append(out, spec)
	}
	return out
}

// CommandLine renders a server as the single command line the legacy
// Registry client spawns.
func (s Server) CommandLine() string {
	parts := []string{shellWord(s.Command)}
	for _, a := range s.Args {
		parts = append(parts, shellWord(a))
	}
	return strings.Join(parts, " ")
}

func shellWord(v string) string {
	if v != "" && !strings.ContainsAny(v, " \t\n'\"\\$`;&|<>()*?[]{}!#~") {
		return v
	}
	return "'" + strings.ReplaceAll(v, "'", `'"'"'`) + "'"
}

// RegistryCommands maps enabled local servers to command lines for Registry.
func RegistryCommands(servers []Server) map[string]string {
	out := map[string]string{}
	for _, s := range servers {
		if s.Enabled && s.Type != "remote" && s.Command != "" {
			out[s.Name] = s.CommandLine()
		}
	}
	return out
}

// Prober runs lightweight status probes and caches the result.
type Prober struct {
	mu      sync.Mutex
	cache   map[string]Server
	ttl     time.Duration
	timeout time.Duration
	client  *http.Client
}

// NewProber returns a prober with a 60s cache and 10s probe timeout.
func NewProber() *Prober {
	return &Prober{cache: map[string]Server{}, ttl: time.Minute, timeout: 10 * time.Second, client: &http.Client{Timeout: 10 * time.Second}}
}

func cacheKey(s Server) string {
	raw, _ := json.Marshal([]any{s.Source, s.Harness, s.Name, s.Type, s.Command, s.Args, s.URL, s.Enabled})
	return string(raw)
}

// Cached fills status from the cache without probing (unknown if absent).
func (p *Prober) Cached(s Server) Server {
	if !s.Enabled {
		s.Status = StatusDisabled
		return s
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if c, ok := p.cache[cacheKey(s)]; ok {
		s.Status, s.Error, s.CheckedAt = c.Status, c.Error, c.CheckedAt
	} else if s.Status == "" {
		s.Status = StatusUnknown
	}
	return s
}

// Probe checks a server now unless a fresh cached result exists (force skips the cache).
func (p *Prober) Probe(ctx context.Context, s Server, force bool) Server {
	if !s.Enabled {
		s.Status, s.Error = StatusDisabled, ""
		return s
	}
	key := cacheKey(s)
	p.mu.Lock()
	if c, ok := p.cache[key]; ok && !force {
		if t, err := time.Parse(time.RFC3339, c.CheckedAt); err == nil && time.Since(t) < p.ttl {
			p.mu.Unlock()
			s.Status, s.Error, s.CheckedAt = c.Status, c.Error, c.CheckedAt
			return s
		}
	}
	p.mu.Unlock()
	probeCtx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	var status, msg string
	if s.Type == "remote" || s.Command == "" && s.URL != "" {
		status, msg = p.probeRemote(probeCtx, s)
	} else {
		status, msg = probeLocal(probeCtx, s)
	}
	s.Status, s.Error, s.CheckedAt = status, msg, time.Now().UTC().Format(time.RFC3339)
	p.mu.Lock()
	p.cache[key] = s
	p.mu.Unlock()
	return s
}

var initializeRequest = []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"orchestra-probe","version":"1.0.0"}}}`)

// probeLocal spawns the server and waits for its initialize response.
func probeLocal(ctx context.Context, s Server) (string, string) {
	if s.Command == "" {
		return StatusFailed, "no command configured"
	}
	cmd := backgroundcommand.CommandContext(ctx, s.Command, s.Args...)
	cmd.Env = os.Environ()
	for k, v := range s.Env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}
	cmd.WaitDelay = time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return StatusFailed, err.Error()
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return StatusFailed, err.Error()
	}
	var stderr bytes.Buffer
	cmd.Stderr = &limitedWriter{w: &stderr, n: 4096}
	if err = cmd.Start(); err != nil {
		return StatusFailed, err.Error()
	}
	defer func() {
		_ = stdin.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()
	if _, err = stdin.Write(append(initializeRequest, '\n')); err != nil {
		return StatusFailed, "write initialize: " + err.Error()
	}
	result := make(chan [2]string, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 4<<20)
		for scanner.Scan() {
			var msg struct {
				ID     json.RawMessage `json:"id"`
				Result json.RawMessage `json:"result"`
				Error  *struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if json.Unmarshal(scanner.Bytes(), &msg) != nil || string(msg.ID) != "1" {
				continue
			}
			if msg.Error != nil {
				result <- [2]string{StatusFailed, "initialize rejected: " + msg.Error.Message}
				return
			}
			result <- [2]string{StatusConnected, ""}
			return
		}
		result <- [2]string{StatusFailed, "server exited before initialize response"}
	}()
	select {
	case r := <-result:
		if r[0] == StatusFailed && stderr.Len() > 0 {
			r[1] += ": " + strings.TrimSpace(stderr.String())
		}
		return r[0], r[1]
	case <-ctx.Done():
		return StatusFailed, "initialize timed out"
	}
}

func (p *Prober) probeRemote(ctx context.Context, s Server) (string, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.URL, bytes.NewReader(initializeRequest))
	if err != nil {
		return StatusFailed, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range s.Headers {
		req.Header.Set(k, v)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return StatusFailed, err.Error()
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, 64*1024)
	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return StatusNeedsAuth, resp.Status
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return StatusConnected, ""
	default:
		return StatusFailed, resp.Status
	}
}

type limitedWriter struct {
	w io.Writer
	n int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if l.n <= 0 {
		return len(p), nil
	}
	chunk := p
	if len(chunk) > l.n {
		chunk = chunk[:l.n]
	}
	l.n -= len(chunk)
	_, _ = l.w.Write(chunk)
	return len(p), nil
}

// ErrServerNotFound is returned when a named server is not configured.
var ErrServerNotFound = errors.New("mcp server not found")

// FindServer returns the server with name from servers.
func FindServer(servers []Server, name string) (Server, error) {
	for _, s := range servers {
		if s.Name == name {
			return s, nil
		}
	}
	return Server{}, fmt.Errorf("%w: %s", ErrServerNotFound, name)
}
