package cli

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type resourceCommand struct {
	kind, action, project, workspace, harness, scope string
	id, requestID, expectedHash, contentFile, format string
	baseURL                                          string
}

func isResourceCommand(args []string) bool {
	return len(args) > 0 && (args[0] == "agent" || args[0] == "skill")
}

func parseResource(args []string) (resourceCommand, error) {
	c := resourceCommand{kind: "agent_definition"}
	if len(args) < 2 || (args[0] != "agent" && args[0] != "skill") {
		return c, errors.New("use agent or skill followed by list/show/create/update/delete/receipt")
	}
	if args[0] == "skill" {
		c.kind = "skill"
	}
	c.action = args[1]
	if c.action != "list" && c.action != "show" && c.action != "create" && c.action != "update" && c.action != "delete" && c.action != "receipt" {
		return c, errors.New("resource action must be list, show, create, update, delete, or receipt")
	}
	seen := map[string]bool{}
	args = args[2:]
	for len(args) > 0 {
		arg := args[0]
		args = args[1:]
		if arg == "--json" {
			if seen[arg] {
				return c, errors.New("duplicate --json")
			}
			seen[arg] = true
			continue
		}
		if seen[arg] {
			return c, errors.New("duplicate option")
		}
		seen[arg] = true
		if len(args) == 0 || strings.HasPrefix(args[0], "--") {
			return c, errors.New("option requires a value")
		}
		value := args[0]
		args = args[1:]
		if strings.TrimSpace(value) == "" {
			return c, errors.New("empty option value")
		}
		switch arg {
		case "--base-url":
			c.baseURL = value
		case "--project":
			c.project = value
		case "--workspace":
			c.workspace = value
		case "--harness":
			c.harness = strings.ToUpper(value)
		case "--scope":
			c.scope = strings.ToLower(value)
		case "--id":
			c.id = value
		case "--request-id":
			c.requestID = value
		case "--expected-hash":
			c.expectedHash = value
		case "--content-file":
			c.contentFile = value
		case "--format":
			c.format = value
		default:
			return c, errors.New("unknown option or unexpected positional argument")
		}
	}
	if c.project == "" {
		return c, errors.New("resource commands require --project")
	}
	if c.action == "receipt" {
		if !validCLIRequestID(c.requestID) {
			return c, errors.New("receipt requires a canonical --request-id UUID")
		}
		if c.harness != "" || c.scope != "" || c.workspace != "" || c.id != "" || c.expectedHash != "" || c.contentFile != "" || c.format != "" {
			return c, errors.New("receipt accepts only --project, --request-id and --base-url")
		}
		return c, nil
	}
	if c.harness == "" || (c.harness != "CODEX" && c.harness != "CLAUDE" && c.harness != "OPENCODE" && c.harness != "ANTIGRAVITY" && c.harness != "OMP" && c.harness != "8GENT") {
		return c, errors.New("resource commands require --harness CODEX, CLAUDE, OPENCODE, ANTIGRAVITY, OMP or 8GENT; Gemini is no longer selectable")
	}
	if c.scope != "project" && c.scope != "global" && c.scope != "effective" {
		return c, errors.New("resource commands require --scope effective, project, or global")
	}
	if c.project == "__orchestrator__" && c.scope != "global" {
		return c, errors.New("__orchestrator__ supports only global resource scope")
	}
	if c.scope == "effective" && c.action != "list" && c.action != "show" {
		return c, errors.New("effective scope is read-only; choose project or global for mutations")
	}
	if c.scope == "global" && c.workspace != "" {
		return c, errors.New("--workspace is only valid with project or effective scope")
	}
	if c.action == "list" {
		if c.id != "" || c.requestID != "" || c.expectedHash != "" || c.contentFile != "" || c.format != "" {
			return c, errors.New("list accepts only scope, harness, project, workspace, and base URL")
		}
		return c, nil
	}
	if c.id == "" {
		return c, errors.New("show/create/update/delete require exact --id")
	}
	if c.action == "show" {
		if c.requestID != "" || c.expectedHash != "" || c.contentFile != "" || c.format != "" {
			return c, errors.New("show accepts only scope, harness, project, workspace, id, and base URL")
		}
		return c, nil
	}
	if c.scope == "effective" || !validCLIRequestID(c.requestID) {
		return c, errors.New("mutations require project/global scope and a canonical --request-id UUID")
	}
	if (c.action == "update" || c.action == "delete") && c.expectedHash == "" {
		return c, errors.New("update/delete require --expected-hash from the latest resource observation")
	}
	if c.expectedHash != "" && !validResourceHash(c.expectedHash) {
		return c, errors.New("--expected-hash must be a lowercase sha256:<64 hex digits> content hash")
	}
	if c.action == "create" && c.expectedHash != "" {
		return c, errors.New("create does not accept --expected-hash")
	}
	if c.action == "delete" && (c.contentFile != "" || c.format != "") {
		return c, errors.New("delete accepts no content file or format")
	}
	if (c.action == "create" || c.action == "update") && c.contentFile == "" {
		return c, errors.New("create/update require --content-file")
	}
	return c, nil
}

func validCLIRequestID(raw string) bool {
	id, err := uuid.Parse(raw)
	return err == nil && id != uuid.Nil && id.String() == raw
}

func validResourceHash(raw string) bool {
	if len(raw) != len("sha256:")+64 || !strings.HasPrefix(raw, "sha256:") || raw != strings.ToLower(raw) {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(raw, "sha256:"))
	return err == nil
}

func runResource(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	c, err := parseResource(args)
	if err != nil {
		return fail(stderr, "invalid_argument", err.Error(), 2)
	}
	if c.baseURL == "" {
		c.baseURL = getenv("ORCHESTRA_BASE_URL")
	}
	base, err := validateOrigin(c.baseURL)
	if err != nil {
		return fail(stderr, "invalid_endpoint", err.Error(), 2)
	}
	token := getenv("ORCHESTRA_API_TOKEN")
	if strings.TrimSpace(token) == "" || strings.ContainsAny(token, "\r\n") {
		return fail(stderr, "missing_auth", "set ORCHESTRA_API_TOKEN to the backend API token", 2)
	}
	content := ""
	if c.contentFile != "" {
		raw, readErr := os.ReadFile(c.contentFile)
		if readErr != nil {
			return fail(stderr, "content_file_unreadable", "could not read the explicitly selected content file", 2)
		}
		if len(raw) > 1<<20 || !utf8.Valid(raw) {
			return fail(stderr, "invalid_content", "content must be valid UTF-8 and at most 1 MiB", 2)
		}
		content = string(raw)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	data, code, err := resourceRequest(ctx, client, base, token, c, content)
	if err != nil {
		return fail(stderr, code, strings.ReplaceAll(err.Error(), token, "[redacted]"), 1)
	}
	if c.action == "list" {
		data, err = filterCatalogItems(data, c.kind)
		if err != nil {
			return fail(stderr, "invalid_response", err.Error(), 1)
		}
	}
	scope := map[string]string{"source": "agent_catalog", "project_id": c.project}
	if c.harness != "" {
		scope["harness"] = c.harness
	}
	if c.scope != "" {
		scope["scope"] = c.scope
	}
	if c.workspace != "" {
		scope["workspace_id"] = c.workspace
	}
	if c.id != "" {
		scope["resource_id"] = c.id
	}
	if c.requestID != "" {
		scope["request_id"] = c.requestID
	}
	origin := *base
	origin.Path = ""
	scope["backend_base_url"] = origin.String()
	commandName := c.kind + " " + c.action
	if c.kind == "agent_definition" {
		commandName = "agent " + c.action
	} else {
		commandName = "skill " + c.action
	}
	output := redact(envelope{1, commandName, scope, data}, token)
	if err := json.NewEncoder(stdout).Encode(output); err != nil {
		return fail(stderr, "output_failed", "could not write JSON output", 1)
	}
	return 0
}

func resourceRequest(ctx context.Context, client *http.Client, base *url.URL, token string, c resourceCommand, content string) (any, string, error) {
	u := *base
	projectPath := "/api/v1/projects/" + url.PathEscape(c.project) + "/agent-catalog"
	method := http.MethodGet
	var body io.Reader
	if c.action == "receipt" {
		u.Path = projectPath + "/receipts/" + url.PathEscape(c.requestID)
	} else if c.action == "list" {
		u.Path = projectPath
	} else {
		u.Path = projectPath + "/resource"
	}
	u.RawPath = ""
	q := url.Values{}
	if c.action != "receipt" {
		q.Set("harness", c.harness)
		q.Set("scope", c.scope)
		if c.workspace != "" {
			q.Set("workspace_id", c.workspace)
		}
		if c.action == "show" || c.action == "create" || c.action == "update" || c.action == "delete" {
			q.Set("kind", c.kind)
			q.Set("resource_id", c.id)
		}
	}
	u.RawQuery = q.Encode()
	switch c.action {
	case "create":
		method = http.MethodPost
	case "update":
		method = http.MethodPut
	case "delete":
		method = http.MethodDelete
	}
	if method != http.MethodGet {
		payload := map[string]string{"request_id": c.requestID}
		if c.expectedHash != "" {
			payload["expected_hash"] = c.expectedHash
		}
		if c.format != "" {
			payload["format"] = c.format
		}
		if c.action != "delete" {
			payload["content"] = content
		}
		raw, _ := json.Marshal(payload)
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, "invalid_request", errors.New("could not construct agent resource request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := client.Do(req)
	if err != nil {
		if method != http.MethodGet {
			return nil, "mutation_unknown", fmt.Errorf("resource mutation outcome unknown; retain request ID %s and inspect its receipt before retrying", c.requestID)
		}
		return nil, "request_failed", errors.New("backend request failed or timed out; check the endpoint and server")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(raw) > maxResponseBytes {
		if method != http.MethodGet {
			return nil, "mutation_unknown", errors.New("resource mutation result unreadable; inspect its receipt before retrying")
		}
		return nil, "invalid_response", errors.New("backend response unreadable or exceeds 8 MiB")
	}
	var data any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err = dec.Decode(&data); err != nil {
		if method != http.MethodGet {
			return nil, "mutation_unknown", errors.New("resource mutation response was not JSON; inspect its receipt before retrying")
		}
		return nil, "invalid_response", errors.New("backend did not return valid JSON")
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		if method != http.MethodGet {
			return nil, "mutation_unknown", errors.New("resource mutation response contained trailing data; inspect its receipt")
		}
		return nil, "invalid_response", errors.New("backend returned trailing JSON or data")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		code := "http_error"
		message := fmt.Sprintf("backend returned HTTP %d; no response body was printed", resp.StatusCode)
		if obj, ok := data.(map[string]any); ok {
			if nested, ok := obj["error"].(map[string]any); ok {
				if v, ok := nested["code"].(string); ok && v != "" {
					code = v
				}
				if v, ok := nested["message"].(string); ok && v != "" {
					message = v
				}
			}
		}
		if method != http.MethodGet && resp.StatusCode >= 500 {
			return nil, "mutation_unknown", fmt.Errorf("server error during resource mutation; retain request ID %s and inspect its receipt before retrying", c.requestID)
		}
		return nil, code, errors.New(message)
	}
	return data, "", nil
}

func filterCatalogItems(data any, kind string) (any, error) {
	catalog, ok := data.(map[string]any)
	if !ok {
		return nil, errors.New("agent catalog response must be an object")
	}
	items, ok := catalog["items"].([]any)
	if !ok {
		return nil, errors.New("agent catalog items must be an array")
	}
	filtered := make([]any, 0, len(items))
	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("agent catalog item must be an object")
		}
		if item["kind"] == kind {
			filtered = append(filtered, raw)
		}
	}
	catalog["items"] = filtered
	return catalog, nil
}
