package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const diagnosticTraceID = "0123456789abcdef0123456789abcdef"

func diagnosticRun(t *testing.T, args []string, handler http.HandlerFunc) (int, string, string) {
	t.Helper()
	server := httptest.NewServer(handler)
	defer server.Close()
	var out, err bytes.Buffer
	code := Run(context.Background(), args, &out, &err, func(key string) string {
		if key == "ORCHESTRA_BASE_URL" {
			return server.URL
		}
		if key == "ORCHESTRA_API_TOKEN" {
			return "test-private-credential"
		}
		return ""
	})
	return code, out.String(), err.String()
}

func TestDiagnosticsAuthenticatedRoutesAndRawMetadata(t *testing.T) {
	for _, action := range []string{"overview", "traces", "logs", "settings", "export", "trace"} {
		t.Run(action, func(t *testing.T) {
			args := []string{"diagnostics", action, "--json"}
			route := action
			body := `{"enabled":true,"retention_days":7,"metrics_retention_days":30,"max_storage_mb":100}`
			switch action {
			case "overview":
				body = `{"settings":{"enabled":true},"total_traces":1,"failed_traces":0,"active_traces":0,"dropped_records":0,"storage_bytes":10,"queue_depth":0}`
			case "traces", "logs":
				body = `{"items":[{"trace_id":"` + diagnosticTraceID + `","name":"http.completed","label":"List projects","description":"Backend API request","http_method":"GET","http_route":"/api/v1/projects","http_status_code":200,"duration_ms":12}],"total":1,"limit":100,"offset":0}`
			case "trace":
				args = append(args, diagnosticTraceID)
				route = "traces/" + diagnosticTraceID
				body = `{"trace":{"trace_id":"` + diagnosticTraceID + `"},"spans":[],"logs":[],"partial":false}`
			case "export":
				body = `{"schema_version":1,"exported_at":"2026-10-08T00:00:00Z","traces":[],"spans":[],"logs":[],"truncated":false}`
			}
			calls := 0
			code, out, err := diagnosticRun(t, args, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Method != "GET" || r.URL.Path != "/api/v1/diagnostics/"+route || r.Header.Get("Authorization") != "Bearer test-private-credential" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				fmt.Fprint(w, body)
			})
			if code != 0 || calls != 1 {
				t.Fatalf("code=%d calls=%d err=%s", code, calls, err)
			}
			var result envelope
			if json.Unmarshal([]byte(out), &result) != nil || result.SchemaVersion != 1 || result.Command != "diagnostics "+action || result.Scope["source"] != "local_diagnostics" {
				t.Fatalf("bad envelope: %s", out)
			}
			if (action == "logs" || action == "traces") && !strings.Contains(out, `"http_route":"/api/v1/projects"`) {
				t.Fatal("lost optional metadata")
			}
		})
	}
}

func TestDiagnosticsFiltersAndScope(t *testing.T) {
	args := []string{"diagnostics", "logs", "--project", "project /x", "--task", "task-1", "--provider", "CODEX", "--status", "error", "--severity", "warn", "--search", "http", "--since", "2026-10-07T00:00:00Z", "--until", "2026-10-08T00:00:00Z", "--limit", "500", "--offset", "1000000", "--json"}
	code, out, err := diagnosticRun(t, args, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		for key, value := range map[string]string{"project_id": "project /x", "task_id": "task-1", "provider": "CODEX", "status": "error", "severity": "warn", "q": "http", "limit": "500", "offset": "1000000", "since": "2026-10-07T00:00:00Z", "until": "2026-10-08T00:00:00Z"} {
			if q.Get(key) != value {
				t.Errorf("%s=%q", key, q.Get(key))
			}
		}
		fmt.Fprint(w, `{"items":[],"total":0,"limit":500,"offset":1000000}`)
	})
	if code != 0 || !strings.Contains(out, `"project_id":"project /x"`) || !strings.Contains(out, `"task_id":"task-1"`) {
		t.Fatalf("%d %s %s", code, out, err)
	}
}

func TestDiagnosticsRejectsInvalidArgumentsBeforeNetwork(t *testing.T) {
	for _, tail := range [][]string{
		{"clear"}, {"settings", "--enabled", "true"}, {"check", "--project", "p"}, {"trace"}, {"trace", "../settings"}, {"trace", strings.ToUpper(diagnosticTraceID)},
		{"trace", diagnosticTraceID, "--limit", "1"}, {"settings", "--search", "x"}, {"overview", "--limit", "1"}, {"overview", "--severity", "error"}, {"traces", "--severity", "warn"}, {"export", "--offset", "1"}, {"export", "--limit", "5"},
		{"logs", "--limit", "501"}, {"logs", "--offset", "1000001"}, {"logs", "--limit", "0"}, {"logs", "--offset", "-1"}, {"logs", "--status", "bad"}, {"logs", "--severity", "warning"}, {"logs", "--provider", strings.Repeat("x", 97)}, {"logs", "--search", strings.Repeat("x", 129)}, {"logs", "--project", strings.Repeat("x", 129)},
		{"logs", "--since", "yesterday"}, {"logs", "--since", "2026-10-08T00:00:00Z", "--until", "2026-10-07T00:00:00Z"}, {"logs", "--json", "--json"}, {"logs", "--token", "secret"},
	} {
		t.Run(strings.Join(tail, " "), func(t *testing.T) {
			code, _, err := diagnosticRun(t, append([]string{"diagnostics"}, tail...), func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected network request") })
			if code != 2 || !strings.Contains(err, "invalid_argument") {
				t.Fatalf("code=%d err=%s", code, err)
			}
		})
	}
}

func TestDiagnosticsFailureBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"old backend", 404, "404 page not found", "incompatible_backend"},
		{"auth", 401, `{"error":{"code":"unauthorized","message":"test-private-credential"}}`, "unauthorized"},
		{"store", 503, `{"error":{"code":"diagnostics_unavailable","message":"test-private-credential"}}`, "diagnostics_unavailable"},
		{"malformed", 200, "{", "invalid_response"}, {"wrong shape", 200, "[]", "invalid_response"}, {"missing fields", 200, "{}", "invalid_response"},
		{"oversized", 200, strings.Repeat(" ", maxResponseBytes+1), "response_too_large"},
		{"extra document", 200, `{"items":[],"total":0,"limit":100,"offset":0} {}`, "invalid_response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			code, out, err := diagnosticRun(t, []string{"diagnostics", "logs", "--json"}, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); fmt.Fprint(w, tc.body) })
			if code != 1 || out != "" || !strings.Contains(err, tc.want) || strings.Contains(err, "test-private-credential") {
				t.Fatalf("code=%d out=%s err=%s", code, out, err)
			}
		})
	}
}

func TestDiagnosticsCheckIsReadOnlyAndHonest(t *testing.T) {
	for _, tc := range []struct {
		enabled bool
		drops   int
		queue   int
		want    string
	}{{true, 0, 0, "collecting"}, {false, 0, 0, "disabled"}, {true, 9, 2, "history_gaps"}} {
		t.Run(tc.want, func(t *testing.T) {
			paths := []string{}
			code, out, err := diagnosticRun(t, []string{"diagnostics", "check", "--json"}, func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.Path)
				if r.Method != "GET" || r.URL.RawQuery != "" {
					t.Error("check mutated or filtered")
				}
				if strings.HasSuffix(r.URL.Path, "settings") {
					fmt.Fprintf(w, `{"enabled":%t,"retention_days":7,"metrics_retention_days":30,"max_storage_mb":100}`, tc.enabled)
				} else {
					fmt.Fprintf(w, `{"settings":{"enabled":%t},"total_traces":1,"failed_traces":0,"active_traces":0,"dropped_records":%d,"queue_depth":%d,"storage_bytes":1024}`, tc.enabled, tc.drops, tc.queue)
				}
			})
			if code != 0 || len(paths) != 2 || paths[0] != "/api/v1/diagnostics/settings" || paths[1] != "/api/v1/diagnostics/overview" || !strings.Contains(out, tc.want) || !strings.Contains(out, `"execution_verified":false`) {
				t.Fatalf("code=%d paths=%v out=%s err=%s", code, paths, out, err)
			}
		})
	}
}

func TestDiagnosticsHumanOutputExplainsAPIActivity(t *testing.T) {
	code, out, err := diagnosticRun(t, []string{"diagnostics", "logs"}, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"items":[{"trace_id":"`+diagnosticTraceID+`","name":"http.completed","timestamp":"2026-10-08T00:00:00Z","severity":"info","http_method":"GET","http_route":"/api/v1/projects","http_status_code":200,"duration_ms":12}],"total":1,"limit":100,"offset":0}`)
	})
	if code != 0 || !strings.Contains(out, "API activity") || !strings.Contains(out, "GET /api/v1/projects") || !strings.Contains(out, "200") || strings.Contains(out, "Task: unknown") {
		t.Fatalf("code=%d out=%s err=%s", code, out, err)
	}
}

func TestDiagnosticsRejectsWrongPageAndTraceIdentity(t *testing.T) {
	for _, tc := range []struct{ action, body string }{
		{"logs", `{"items":[],"total":0,"limit":0,"offset":0}`},
		{"logs", `{"items":[],"total":0,"limit":100,"offset":1000001}`},
		{"overview", `{"settings":{},"total_traces":0,"failed_traces":0,"active_traces":0,"dropped_records":0,"storage_bytes":0,"queue_depth":0}`},
		{"overview", `{"settings":{"enabled":true},"total_traces":0,"failed_traces":0,"active_traces":0,"dropped_records":0,"storage_bytes":0,"queue_depth":0,"operations":["invalid row"]}`},
		{"trace", `{"trace":{"trace_id":"ffffffffffffffffffffffffffffffff"},"spans":[],"logs":[],"partial":false}`},
		{"trace", `{"trace":{"trace_id":"` + diagnosticTraceID + `"},"spans":[{"trace_id":"ffffffffffffffffffffffffffffffff"}],"logs":[],"partial":false}`},
	} {
		t.Run(tc.action+tc.body, func(t *testing.T) {
			args := []string{"diagnostics", tc.action, "--json"}
			if tc.action == "trace" {
				args = append(args, diagnosticTraceID)
			}
			code, _, err := diagnosticRun(t, args, func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, tc.body) })
			if code != 1 || !strings.Contains(err, "invalid_response") {
				t.Fatalf("code=%d err=%s", code, err)
			}
		})
	}
}

func TestDiagnosticsDoesNotFollowRedirectsOrLeakCredential(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer target.Close()
	code, out, err := diagnosticRun(t, []string{"diagnostics", "logs", "--json"}, func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) })
	if called || code != 1 || out != "" || !strings.Contains(err, "http_error") {
		t.Fatalf("followed=%t code=%d out=%s err=%s", called, code, out, err)
	}
	code, out, err = diagnosticRun(t, []string{"diagnostics", "logs", "--json"}, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"items":[{"name":"test-private-credential","secret":"anything","test-private-credential":"secret key"}],"total":1,"limit":100,"offset":0}`)
	})
	if code != 0 || strings.Contains(out, "test-private-credential") || strings.Contains(out, "anything") || !strings.Contains(out, "REDACTED") {
		t.Fatalf("code=%d out=%s err=%s", code, out, err)
	}
}

func TestDiagnosticsConnectionAndMissingAuthFailBeforeRequest(t *testing.T) {
	for _, tc := range []struct{ origin, token, want string }{
		{"http://example.com", "credential", "invalid_endpoint"},
		{"http://127.0.0.1:1", "", "missing_auth"},
		{"http://127.0.0.1:1", "credential\n", "missing_auth"},
	} {
		var out, err bytes.Buffer
		code := Run(context.Background(), []string{"diagnostics", "settings"}, &out, &err, func(k string) string {
			if k == "ORCHESTRA_BASE_URL" {
				return tc.origin
			}
			if k == "ORCHESTRA_API_TOKEN" {
				return tc.token
			}
			return ""
		})
		if code != 2 || !strings.Contains(err.String(), tc.want) || out.Len() != 0 {
			t.Fatalf("code=%d out=%s err=%s", code, out.String(), err.String())
		}
	}
}
