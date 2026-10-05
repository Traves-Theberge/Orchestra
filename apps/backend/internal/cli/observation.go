// Package cli exposes observations and bounded controls of the backend used by the UI.
package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const Help = `usage: orchestra <command>
  start | check | check-pr-body <path>
  status --json
  project list --json
  project show <project-id> --json
  task list [--project <project-id>] [--states <comma-separated>] --json
  task show (--id <task-id> | --identifier <issue-identifier>) [--project <project-id>] --json
  task create --project <project-id> --request-id <uuid> --title <title> [--description <text>] [--assignee <id>] [--provider <harness>] --json
  task queue --project <project-id> --id <task-id> --request-id <uuid> --expected-state Backlog --json
  control receipt --request-id <uuid> --json
  control projects --json
  control tasks --project <project-id> --json
  control worktrees --project <project-id> --json
  control status --json

Observation commands accept --base-url <origin>, or ORCHESTRA_BASE_URL.
ORCHESTRA_API_TOKEN must be set in the environment; there is no token flag.
Only HTTPS or loopback HTTP origins are accepted. Requests time out after 10 seconds.
Success: versioned JSON envelope on stdout. Failure: JSON error on stderr, nonzero exit.
Task show returns the tracked task, not a guessed worktree, run or provider session.
Create makes a Backlog task. Queue requests Todo admission, not an observed agent/worktree.
Mutations persist request identity; unknown outcomes require receipt/task reconciliation.
No destructive stop/pause/delete, worktree creation/removal or PR mutations are exposed.`

const maxResponseBytes = 8 << 20

type command struct {
	name, baseURL, project, states, id, identifier                   string
	show                                                             bool
	requestID, title, description, assignee, provider, expectedState string
}

type envelope struct {
	SchemaVersion int               `json:"schema_version"`
	Command       string            `json:"command"`
	Scope         map[string]string `json:"scope"`
	Data          any               `json:"data"`
}

type failure struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func fail(w io.Writer, code, message string, exitCode int) int {
	_ = json.NewEncoder(w).Encode(struct {
		SchemaVersion int     `json:"schema_version"`
		Error         failure `json:"error"`
	}{1, failure{code, message}})
	return exitCode
}

// Run never discovers credentials or endpoints from a home directory or current repository.
func Run(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	for _, arg := range args {
		if arg == "--help" || arg == "-h" {
			fmt.Fprintln(stdout, Help)
			return 0
		}
	}
	c, err := parse(args)
	if err != nil {
		return fail(stderr, "invalid_argument", err.Error(), 2)
	}
	if c.baseURL == "" {
		c.baseURL = getenv("ORCHESTRA_BASE_URL")
	}
	u, err := validateOrigin(c.baseURL)
	if err != nil {
		return fail(stderr, "invalid_endpoint", err.Error(), 2)
	}
	token := getenv("ORCHESTRA_API_TOKEN")
	if strings.TrimSpace(token) == "" || strings.ContainsAny(token, "\r\n") {
		return fail(stderr, "missing_auth", "set ORCHESTRA_API_TOKEN to the backend API token", 2)
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	var data any
	var code string
	if c.name == "task create" || c.name == "task queue" || strings.HasPrefix(c.name, "control ") {
		data, code, err = controlRequest(ctx, client, u, token, c)
	} else {
		data, code, err = observe(ctx, client, u, token, c)
	}
	if err != nil {
		return fail(stderr, code, err.Error(), 1)
	}
	scope := map[string]string{"source": "registered_projects"}
	if strings.HasPrefix(c.name, "task ") {
		scope["source"] = "global_tracker"
	}
	if c.project != "" {
		scope = map[string]string{"source": "project_filter", "project_id": c.project}
	}
	if c.states != "" {
		scope["states"] = c.states
	}
	if c.id != "" {
		if c.name == "project show" {
			scope = map[string]string{"source": "project", "project_id": c.id}
		} else {
			scope["task_id"] = c.id
		}
	}
	if c.identifier != "" {
		scope["issue_identifier"] = c.identifier
	}
	if c.name == "status" {
		scope = map[string]string{"source": "backend_snapshot"}
	}
	if strings.HasPrefix(c.name, "control ") || c.name == "task create" || c.name == "task queue" {
		scope["source"] = "orchestra_control"
		if c.requestID != "" {
			scope["request_id"] = c.requestID
		}
	}
	origin := *u
	origin.Path = ""
	scope["backend_base_url"] = origin.String()
	output := redact(envelope{1, c.name, scope, data}, token)
	if err := json.NewEncoder(stdout).Encode(output); err != nil {
		return fail(stderr, "output_failed", "could not write JSON output", 1)
	}
	return 0
}

func parse(args []string) (command, error) {
	c := command{}
	if len(args) == 0 {
		return c, errors.New("a command is required")
	}
	c.name = args[0]
	args = args[1:]
	if c.name == "project" || c.name == "task" || c.name == "control" {
		if len(args) == 0 || !((c.name == "project" && (args[0] == "list" || args[0] == "show")) || (c.name == "task" && (args[0] == "list" || args[0] == "show" || args[0] == "create" || args[0] == "queue")) || (c.name == "control" && (args[0] == "receipt" || args[0] == "projects" || args[0] == "tasks" || args[0] == "worktrees" || args[0] == "status"))) {
			return c, errors.New("use project list/show, task list/show/create/queue, or control projects/tasks/worktrees/status/receipt")
		}
		c.show = args[0] == "show"
		c.name += " " + args[0]
		args = args[1:]
	} else if c.name != "status" {
		return c, errors.New("unknown observation command")
	}
	seen := map[string]bool{}
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
		if c.name == "project show" && !strings.HasPrefix(arg, "-") && c.id == "" {
			c.id = arg
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
			if !strings.HasPrefix(c.name, "task ") && c.name != "control tasks" && c.name != "control worktrees" {
				return c, errors.New("--project is only supported for tasks")
			}
			c.project = value
		case "--states":
			if c.name != "task list" {
				return c, errors.New("--states is only supported for task list")
			}
			c.states = value
		case "--id":
			if c.name != "task show" && c.name != "task queue" {
				return c, errors.New("--id is only supported for task show/queue")
			}
			c.id = value
		case "--identifier":
			if c.name != "task show" {
				return c, errors.New("--identifier is only supported for task show")
			}
			c.identifier = value
		case "--request-id":
			if c.name != "task create" && c.name != "task queue" && c.name != "control receipt" {
				return c, errors.New("--request-id only supports mutations/receipt")
			}
			c.requestID = value
		case "--title", "--description", "--assignee", "--provider":
			if c.name != "task create" {
				return c, errors.New("task metadata flags only support task create")
			}
			switch arg {
			case "--title":
				c.title = value
			case "--description":
				c.description = value
			case "--assignee":
				c.assignee = value
			case "--provider":
				c.provider = value
			}
		case "--expected-state":
			if c.name != "task queue" || value != "Backlog" {
				return c, errors.New("queue requires --expected-state Backlog")
			}
			c.expectedState = value
		default:
			return c, errors.New("unknown option or unexpected positional argument")
		}
	}
	if c.name == "project show" && c.id == "" {
		return c, errors.New("project show requires a project ID")
	}
	if c.name == "task show" && ((c.id == "") == (c.identifier == "")) {
		return c, errors.New("task show requires exactly one of --id or --identifier")
	}
	if c.name == "task create" && (c.project == "" || c.requestID == "" || c.title == "") {
		return c, errors.New("task create requires --project, --request-id and --title")
	}
	if c.name == "task queue" && (c.project == "" || c.id == "" || c.requestID == "" || c.expectedState != "Backlog") {
		return c, errors.New("task queue requires --project, --id, --request-id and --expected-state Backlog")
	}
	if c.name == "control receipt" && c.requestID == "" {
		return c, errors.New("control receipt requires --request-id")
	}
	if (c.name == "control tasks" || c.name == "control worktrees") && c.project == "" {
		return c, errors.New("scoped control observations require --project")
	}
	return c, nil
}

func validateOrigin(value string) (*url.URL, error) {
	u, err := url.Parse(value)
	if err != nil || value == "" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("set --base-url or ORCHESTRA_BASE_URL to an HTTP(S) origin without credentials, path, query or fragment")
	}
	if u.Scheme != "https" {
		ip := net.ParseIP(u.Hostname())
		if u.Scheme != "http" || (u.Hostname() != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return nil, errors.New("use HTTPS for remote backends; HTTP is permitted only on loopback")
		}
	}
	return u, nil
}

func observe(ctx context.Context, client *http.Client, base *url.URL, token string, c command) (any, string, error) {
	if c.project != "" {
		if _, code, err := observe(ctx, client, base, token, command{name: "project show", show: true, id: c.project}); err != nil {
			return nil, code, err
		}
	}
	path := "/api/v1/state"
	if strings.HasPrefix(c.name, "project ") {
		path = "/api/v1/projects"
	}
	if strings.HasPrefix(c.name, "task ") {
		path = "/api/v1/issues"
	}
	u := *base
	u.Path = path
	u.RawPath = ""
	q := url.Values{}
	if c.project != "" {
		q.Set("project_id", c.project)
	}
	if c.states != "" {
		q.Set("states", c.states)
	}
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "request_failed", errors.New("could not construct backend request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "request_failed", errors.New("backend request failed or timed out; check the endpoint and server")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "http_error", fmt.Errorf("backend returned HTTP %d; no response body was printed", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(body) > maxResponseBytes {
		return nil, "invalid_response", errors.New("backend response unreadable or exceeds 8 MiB")
	}
	var data any
	dec := json.NewDecoder(strings.NewReader(string(body)))
	dec.UseNumber()
	if err := dec.Decode(&data); err != nil {
		return nil, "invalid_response", errors.New("backend did not return valid JSON")
	}
	var trailing any
	if dec.Decode(&trailing) != io.EOF {
		return nil, "invalid_response", errors.New("backend returned trailing JSON or data")
	}
	if c.name == "status" {
		obj, ok := data.(map[string]any)
		if !ok {
			return nil, "invalid_response", errors.New("expected a backend state object")
		}
		counts, ok := obj["counts"].(map[string]any)
		if !ok {
			return nil, "invalid_response", errors.New("backend state counts missing")
		}
		for _, field := range []string{"running", "retrying"} {
			if _, ok := counts[field].(json.Number); !ok {
				return nil, "invalid_response", errors.New("backend state count invalid")
			}
			if _, ok := obj[field].([]any); !ok {
				return nil, "invalid_response", errors.New("backend state entries missing or invalid")
			}
		}
		return data, "", nil
	}
	var items []any
	if strings.HasPrefix(c.name, "project ") {
		if data == nil {
			items = []any{}
		} else {
			var ok bool
			items, ok = data.([]any)
			if !ok {
				return nil, "invalid_response", errors.New("expected a project array")
			}
		}
	} else {
		obj, ok := data.(map[string]any)
		if !ok {
			return nil, "invalid_response", errors.New("expected an issues object")
		}
		raw, exists := obj["issues"]
		if !exists {
			return nil, "invalid_response", errors.New("issues field missing")
		}
		if raw == nil {
			items = []any{}
			obj["issues"] = items
		} else {
			items, ok = raw.([]any)
			if !ok {
				return nil, "invalid_response", errors.New("expected an issues array")
			}
		}
	}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, "invalid_response", errors.New("expected a project/task object")
		}
		id, ok := obj["id"].(string)
		if !ok || id == "" {
			return nil, "invalid_response", errors.New("project/task ID is missing")
		}
		if strings.HasPrefix(c.name, "task ") {
			identifier, ok := obj["identifier"].(string)
			if !ok || identifier == "" {
				return nil, "invalid_response", errors.New("task identifier is missing")
			}
			if c.project != "" && obj["project_id"] != c.project {
				return nil, "scope_conflict", errors.New("backend returned a task outside the requested project")
			}
		}
	}
	if !c.show {
		if strings.HasPrefix(c.name, "project ") {
			return items, "", nil
		}
		return data, "", nil
	}
	matches := []any{}
	key, value := "id", c.id
	if c.identifier != "" {
		key, value = "identifier", c.identifier
	}
	for _, item := range items {
		obj, ok := item.(map[string]any)
		if !ok {
			return nil, "invalid_response", errors.New("expected a project/task object")
		}
		if obj[key] == value && (c.project == "" || obj["project_id"] == c.project) {
			matches = append(matches, item)
		}
	}
	if len(matches) == 0 {
		return nil, "not_found", errors.New("no exact matching registered project or tracked task in the requested scope")
	}
	if len(matches) > 1 {
		return nil, "ambiguous_identity", errors.New("multiple exact matches; use the task ID and project scope rather than guessing")
	}
	return matches[0], "", nil
}

// Redact the API credential even if a backend echoes it inside arbitrary data.
func redact(value any, token string) any {
	b, _ := json.Marshal(value)
	var data any
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.UseNumber()
	_ = dec.Decode(&data)
	return redactValue(data, token)
}

func redactValue(value any, token string) any {
	switch v := value.(type) {
	case string:
		return strings.ReplaceAll(v, token, "[REDACTED]")
	case []any:
		for i := range v {
			v[i] = redactValue(v[i], token)
		}
	case map[string]any:
		for key, item := range v {
			cleanKey := strings.ReplaceAll(key, token, "[REDACTED]")
			if cleanKey != key {
				delete(v, key)
			}
			switch strings.ToLower(key) {
			case "token", "api_token", "github_token", "access_token", "refresh_token", "password", "secret":
				v[cleanKey] = "[REDACTED]"
			default:
				v[cleanKey] = redactValue(item, token)
			}
		}
	}
	return value
}
