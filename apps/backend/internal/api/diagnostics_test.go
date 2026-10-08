package api

import (
	"context"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/diagnostics"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
	"gopkg.in/yaml.v3"
)

func diagnosticsRouter(t *testing.T, recorder *diagnostics.Service) http.Handler {
	t.Helper()
	return NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), APIToken: "diagnostics-test"}, nil, nil, nil, nil, nil, nil, nil, recorder)
}

func TestHTTPDiagnosticTemplatesAndActualResponseCodes(t *testing.T) {
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "telemetry.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	router := chi.NewRouter()
	router.Use((&Server{diagnostics: recorder}).diagnosticsHTTP)
	router.Get("/api/v1/tasks/{task_id}", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(409) })
	router.Get("/health", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })
	diagnosticRequest(router, "GET", "/api/v1/tasks/PRIVATE_TASK_ID?token=PRIVATE_TOKEN", "", "PRIVATE_CREDENTIAL")
	diagnosticRequest(router, "GET", "/health", "", "")
	diagnosticRequest(router, "GET", "/PRIVATE_UNMATCHED_PATH?secret=PRIVATE_QUERY", "", "")
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	out, err := recorder.Export(context.Background(), diagnostics.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	if strings.Contains(string(raw), "PRIVATE_") {
		t.Fatalf("private request material persisted: %s", raw)
	}
	seen := map[string]int{}
	for _, span := range out.Spans {
		seen[span.HTTPRoute] = span.HTTPStatusCode
	}
	if seen["/api/v1/tasks/{task_id}"] != 409 || seen["/health"] != 200 || seen[""] != 404 {
		t.Fatalf("HTTP evidence: %+v", out.Spans)
	}
	for _, log := range out.Logs {
		if log.HTTPStatusCode == 0 || log.DurationMS == nil || log.Label == "" || log.Description == "" {
			t.Fatalf("HTTP log evidence: %+v", log)
		}
	}
}

func TestCancelledHTTPRecordsResponseWithoutClaimingSuccessfulCompletion(t *testing.T) {
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "telemetry.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	router := chi.NewRouter()
	router.Use((&Server{diagnostics: recorder}).diagnosticsHTTP)
	router.Get("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	request := httptest.NewRequest("GET", "/health", nil).WithContext(ctx)
	router.ServeHTTP(httptest.NewRecorder(), request)
	if err := recorder.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	out, err := recorder.Export(context.Background(), diagnostics.Filter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Spans) != 1 || out.Spans[0].Status != "cancelled" || out.Spans[0].HTTPStatusCode != 200 || out.Logs[0].Severity != "info" || strings.Contains(out.Logs[0].Description, "success") {
		t.Fatalf("cancelled HTTP evidence: %+v", out)
	}
}

func TestDiagnosticsOpenAPIContract(t *testing.T) {
	var document struct {
		Paths      map[string]map[string]yaml.Node `yaml:"paths"`
		Components struct {
			Schemas map[string]yaml.Node `yaml:"schemas"`
		} `yaml:"components"`
	}
	if err := yaml.Unmarshal(openAPISpec, &document); err != nil {
		t.Fatal(err)
	}
	for path, methods := range map[string][]string{"traces": {"get"}, "traces/{trace_id}": {"get"}, "logs": {"get"}, "overview": {"get"}, "settings": {"get", "put"}, "history": {"delete"}, "export": {"get"}} {
		for _, method := range methods {
			node, ok := document.Paths["/api/v1/diagnostics/"+path][method]
			if !ok {
				t.Errorf("missing diagnostic contract: %s %s", method, path)
				continue
			}
			var operation struct {
				Security  []map[string][]string `yaml:"security"`
				Responses map[string]yaml.Node  `yaml:"responses"`
			}
			if err := node.Decode(&operation); err != nil {
				t.Fatal(err)
			}
			if len(operation.Security) != 1 {
				t.Errorf("missing explicit bearer security: %s %s", method, path)
			}
			for _, status := range []string{"401", "503"} {
				if _, ok := operation.Responses[status]; !ok {
					t.Errorf("missing %s response: %s %s", status, method, path)
				}
			}
		}
	}
	for _, name := range []string{"DiagnosticSpan", "DiagnosticTracePage", "DiagnosticTraceDetail", "DiagnosticLogPage", "DiagnosticOverview", "DiagnosticSettings", "DiagnosticExport"} {
		if _, ok := document.Components.Schemas[name]; !ok {
			t.Errorf("missing diagnostic schema %s", name)
		}
	}
}
func diagnosticRequest(router http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.RemoteAddr = "10.2.3.4:1234"
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+token)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}
func TestDiagnosticsRoutesRequireAuthAndUnavailableIsExplicit(t *testing.T) {
	router := diagnosticsRouter(t, nil)
	for _, v := range []struct{ method, path string }{{"GET", "traces"}, {"GET", "traces/01234567890123456789012345678901"}, {"GET", "logs"}, {"GET", "overview"}, {"GET", "settings"}, {"PUT", "settings"}, {"DELETE", "history"}, {"GET", "export"}} {
		path := "/api/v1/diagnostics/" + v.path
		for _, token := range []string{"", "wrong"} {
			if got := diagnosticRequest(router, v.method, path, "{}", token); got.Code != 401 {
				t.Fatalf("%s %s: auth = %d", v.method, path, got.Code)
			}
		}
		if got := diagnosticRequest(router, v.method, path, "{}", "diagnostics-test"); got.Code != 503 {
			t.Fatalf("%s %s: unavailable = %d: %s", v.method, path, got.Code, got.Body)
		}
	}
}
func TestDiagnosticsQueriesSettingsAndSanitizedExport(t *testing.T) {
	ctx := context.Background()
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "telemetry.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	_, span := recorder.Start(ctx, "task.attempt", diagnostics.Fields{ProjectID: "project", TaskID: "task", Provider: "CODEX"})
	span.Event("provider.failed", "error")
	span.End("error")
	if err = recorder.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	router := diagnosticsRouter(t, recorder)
	request := func(method, path, body string) *httptest.ResponseRecorder {
		return diagnosticRequest(router, method, "/api/v1/diagnostics/"+path, body, "diagnostics-test")
	}
	got := request("GET", "traces?project_id=project&task_id=task&provider=CODEX&status=error&limit=1&offset=0", "")
	var page diagnostics.TracePage
	if got.Code != 200 {
		t.Fatalf("traces: %d %s", got.Code, got.Body)
	}
	if err = json.Unmarshal(got.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Limit != 1 {
		t.Fatalf("page %+v", page)
	}
	for _, path := range []string{"traces/" + page.Items[0].TraceID, "logs?task_id=task", "overview?project_id=project", "settings", "export?task_id=task"} {
		got = request("GET", path, "")
		if got.Code != 200 {
			t.Fatalf("%s: %d %s", path, got.Code, got.Body)
		}
	}
	for _, query := range []string{"limit=0", "limit=501", "limit=garbage", "offset=-1", "offset=99999999999999999999", "since=tomorrow", "since=2026-10-07T00:00:00Z&until=2026-10-06T00:00:00Z", "status=secret", "provider=" + strings.Repeat("x", 201), "unknown=value", "limit=1&limit=2"} {
		if got = request("GET", "traces?"+query, ""); got.Code != 400 {
			t.Errorf("query %q = %d", query, got.Code)
		}
	}
	if got = request("GET", "traces/00000000000000000000000000000000", ""); got.Code != 404 {
		t.Fatalf("missing trace: %d", got.Code)
	}
	for _, body := range []string{`{}`, `{"enabled":true,"retention_days":0,"metrics_retention_days":30,"max_storage_mb":250}`, `{"enabled":true,"retention_days":7,"metrics_retention_days":30,"max_storage_mb":250,"password":"secret"}`, `{"enabled":true,"retention_days":7,"metrics_retention_days":30,"max_storage_mb":250} {}`} {
		if got = request("PUT", "settings", body); got.Code != 400 {
			t.Errorf("settings %s = %d", body, got.Code)
		}
	}
	if got = request("PUT", "settings", `{"enabled":false,"retention_days":7,"metrics_retention_days":30,"max_storage_mb":250}`); got.Code != 200 {
		t.Fatalf("update: %d %s", got.Code, got.Body)
	}
	got = request("GET", "export?task_id=task", "")
	if strings.Contains(got.Body.String(), "password") || got.Header().Get("Content-Disposition") == "" {
		t.Fatalf("export: %s", got.Body)
	}
	if got = request("DELETE", "history", ""); got.Code != 204 {
		t.Fatalf("clear: %d", got.Code)
	}
	got = request("GET", "traces", "")
	if err = json.Unmarshal(got.Body.Bytes(), &page); err != nil || page.Total != 0 {
		t.Fatalf("cleared: %s %v", got.Body, err)
	}
}
func TestHTTPDiagnosticsUsesW3CParentAndDoesNotTraceReads(t *testing.T) {
	ctx := context.Background()
	recorder, err := diagnostics.Open(filepath.Join(t.TempDir(), "telemetry.db"), diagnostics.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer recorder.Close()
	server := httptest.NewServer(diagnosticsRouter(t, recorder))
	defer server.Close()
	request, _ := http.NewRequest("GET", server.URL+"/api/v1/state?secret=DO_NOT_STORE", nil)
	request.Header.Set("Authorization", "Bearer diagnostics-test")
	request.Header.Set("traceparent", "00-11111111111111111111111111111111-2222222222222222-01")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if err = recorder.Flush(ctx); err != nil {
		t.Fatal(err)
	}
	detail, err := recorder.Trace(ctx, "11111111111111111111111111111111")
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Spans) != 1 || detail.Spans[0].ParentSpanID != "2222222222222222" || detail.Spans[0].Status != "ok" {
		t.Fatalf("HTTP span %+v", detail)
	}
	response, err = http.Get(server.URL + "/api/v1/diagnostics/settings")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	recorder.Flush(ctx)
	page, err := recorder.ListTraces(ctx, diagnostics.Filter{})
	if err != nil || page.Total != 1 {
		t.Fatalf("diagnostics polling self recorded: %+v %v", page, err)
	}
	exported, err := recorder.Export(ctx, diagnostics.Filter{})
	raw, _ := json.Marshal(exported)
	if err != nil || strings.Contains(string(raw), "DO_NOT_STORE") {
		t.Fatalf("privacy: %s %v", raw, err)
	}
}
