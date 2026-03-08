package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/rs/zerolog"
)

type sseFrame struct {
	Event string
	Data  string
}

func parseSSEFrames(body string) []sseFrame {
	chunks := strings.Split(body, "\n\n")
	frames := make([]sseFrame, 0, len(chunks))
	for _, chunk := range chunks {
		chunk = strings.TrimSpace(chunk)
		if chunk == "" {
			continue
		}
		frame := sseFrame{}
		for _, line := range strings.Split(chunk, "\n") {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "event:") {
				frame.Event = strings.TrimSpace(strings.TrimPrefix(trimmed, "event:"))
			}
			if strings.HasPrefix(trimmed, "data:") {
				frame.Data = strings.TrimSpace(strings.TrimPrefix(trimmed, "data:"))
			}
		}
		if frame.Event != "" {
			frames = append(frames, frame)
		}
	}
	return frames
}

func TestProtectedEndpointsRequireBearerTokenOnNonLoopbackHost(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "0.0.0.0", APIToken: "top-secret"})

	refreshNoAuth := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", nil)
	refreshNoAuthRes := httptest.NewRecorder()
	router.ServeHTTP(refreshNoAuthRes, refreshNoAuth)
	if refreshNoAuthRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without auth, got %d", refreshNoAuthRes.Code)
	}

	refreshAuth := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", nil)
	refreshAuth.Header.Set("Authorization", "Bearer top-secret")
	refreshAuthRes := httptest.NewRecorder()
	router.ServeHTTP(refreshAuthRes, refreshAuth)
	if refreshAuthRes.Code != http.StatusAccepted {
		t.Fatalf("expected 202 with valid auth, got %d", refreshAuthRes.Code)
	}

	migrateNoAuth := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/migrate", nil)
	migrateNoAuthRes := httptest.NewRecorder()
	router.ServeHTTP(migrateNoAuthRes, migrateNoAuth)
	if migrateNoAuthRes.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for workspace migrate without auth, got %d", migrateNoAuthRes.Code)
	}

	migrateAuth := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/migrate", nil)
	migrateAuth.Header.Set("Authorization", "Bearer top-secret")
	migrateAuthRes := httptest.NewRecorder()
	router.ServeHTTP(migrateAuthRes, migrateAuth)
	if migrateAuthRes.Code != http.StatusAccepted {
		t.Fatalf("expected 202 for workspace migrate with auth, got %d", migrateAuthRes.Code)
	}

	planReq := httptest.NewRequest(http.MethodGet, "/api/v1/workspace/migration/plan", nil)
	planRes := httptest.NewRecorder()
	router.ServeHTTP(planRes, planReq)
	if planRes.Code != http.StatusOK {
		t.Fatalf("expected plan endpoint unprotected, got %d", planRes.Code)
	}
}

func TestProtectedEndpointsRemainOpenOnLoopbackHost(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "top-secret"})

	refreshReq := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", nil)
	refreshRes := httptest.NewRecorder()
	router.ServeHTTP(refreshRes, refreshReq)
	if refreshRes.Code != http.StatusAccepted {
		t.Fatalf("expected refresh unprotected on loopback host, got %d", refreshRes.Code)
	}

	migrateReq := httptest.NewRequest(http.MethodPost, "/api/v1/workspace/migrate", nil)
	migrateRes := httptest.NewRecorder()
	router.ServeHTTP(migrateRes, migrateReq)
	if migrateRes.Code != http.StatusAccepted {
		t.Fatalf("expected workspace migrate unprotected on loopback host, got %d", migrateRes.Code)
	}
}

func TestAPICorsPreflightAllowsLoopbackOrigin(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodOptions, "/api/v1/state", nil)
	req.Header.Set("Origin", "http://127.0.0.1:3000")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200 preflight response, got %d", res.Code)
	}
	if allowOrigin := res.Header().Get("Access-Control-Allow-Origin"); allowOrigin != "http://127.0.0.1:3000" {
		t.Fatalf("expected reflected allow origin header, got %q", allowOrigin)
	}
	if allowMethods := res.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(allowMethods, http.MethodGet) {
		t.Fatalf("expected allow methods to include GET, got %q", allowMethods)
	}
}

func TestEventsEndpointStreamsSnapshotFrame(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?once=1", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}

	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("expected text/event-stream content type, got %q", ct)
	}

	body := res.Body.String()
	if !strings.Contains(body, "event: snapshot") {
		t.Fatalf("expected snapshot event frame, got %q", body)
	}
	if !strings.Contains(body, "data: {") {
		t.Fatalf("expected json data frame, got %q", body)
	}
}

func TestEventsEndpointSnapshotIncludesRateLimits(t *testing.T) {
	service := orchestrator.NewService()
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})
	service.RecordRunEvent("1", agents.Event{
		Kind:      "thread/rate_limits",
		Timestamp: time.Now().UTC(),
		Raw: map[string]any{
			"meta": map[string]any{
				"data": []any{map[string]any{"rate_limits": map[string]any{"remaining": 9}}},
			},
		},
	})

	router := NewRouter(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?once=1", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}
	body := res.Body.String()
	if !strings.Contains(body, "\"rate_limits\":") {
		t.Fatalf("expected rate_limits in snapshot frame, got %q", body)
	}
	if !strings.Contains(body, "\"remaining\":9") {
		t.Fatalf("expected rate limits payload in snapshot frame, got %q", body)
	}
}

func TestEventsEndpointStreamingSnapshotReflectsUpdatedRateLimits(t *testing.T) {
	service := orchestrator.NewService()
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(100 * time.Millisecond)
		service.RecordRunEvent("1", agents.Event{
			Kind:      "thread/rate_limits",
			Timestamp: time.Now().UTC(),
			Raw:       map[string]any{"meta": map[string]any{"data": []any{map[string]any{"rate_limits": map[string]any{"remaining": 5}}}}},
		})
		pubsub.Publish(observability.Event{Type: "run_event", Data: map[string]any{"issue_id": "1"}})
		time.Sleep(5200 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if strings.Count(body, "event: snapshot") < 2 {
		t.Fatalf("expected at least two snapshot frames, got %q", body)
	}
	if !strings.Contains(body, "\"rate_limits\":{\"remaining\":5}") {
		t.Fatalf("expected updated rate_limits in subsequent snapshot frame, got %q", body)
	}
}

func TestWorkspaceMigrationPlanEndpoint(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspace/migration/plan", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", res.Code)
	}

	body := res.Body.String()
	if !strings.Contains(body, "\"result\"") {
		t.Fatalf("expected result payload in migration plan response, got %q", body)
	}

	assertResponseMatchesSchema(t, res.Body.Bytes(), "workspace.migration.plan.response.schema.json")
}

func TestEventsEndpointStreamsPubSubEvent(t *testing.T) {
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_event", Data: map[string]any{"issue_id": "ORC-1"}})
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if !strings.Contains(body, "event: run_event") {
		t.Fatalf("expected run_event in SSE stream, got %q", body)
	}
}

func TestEventsEndpointPublishesImmediateSnapshotAfterPubSubEvent(t *testing.T) {
	service := orchestrator.NewService()
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1"}})
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		service.RecordRunEvent("1", agents.Event{
			Kind:      "thread/rate_limits",
			Timestamp: time.Now().UTC(),
			Raw:       map[string]any{"rate_limits": map[string]any{"remaining": 4}},
		})
		pubsub.Publish(observability.Event{Type: "run_event", Data: map[string]any{"issue_id": "1"}})
		time.Sleep(80 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if !strings.Contains(body, "event: run_event") {
		t.Fatalf("expected run_event in stream, got %q", body)
	}
	runEventIndex := strings.Index(body, "event: run_event")
	snapshotAfterRunEventIndex := strings.Index(body[runEventIndex+1:], "event: snapshot")
	if runEventIndex < 0 || snapshotAfterRunEventIndex < 0 {
		t.Fatalf("expected immediate snapshot after run_event, got %q", body)
	}
	if !strings.Contains(body, "\"rate_limits\":{\"remaining\":4}") {
		t.Fatalf("expected immediate snapshot with updated rate limits, got %q", body)
	}
}

func TestEventsEndpointStreamsLifecycleEvents(t *testing.T) {
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_started", Data: map[string]any{"issue_id": "1", "attempt": float64(1)}})
		pubsub.Publish(observability.Event{Type: "retry_scheduled", Data: map[string]any{"issue_id": "1", "due_at": "2026-01-01T00:00:00Z"}})
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if !strings.Contains(body, "event: run_started") {
		t.Fatalf("expected run_started in SSE stream, got %q", body)
	}
	if !strings.Contains(body, "event: retry_scheduled") {
		t.Fatalf("expected retry_scheduled in SSE stream, got %q", body)
	}
	if !strings.Contains(body, "\"due_at\":\"2026-01-01T00:00:00Z\"") {
		t.Fatalf("expected lifecycle payload in SSE stream, got %q", body)
	}
}

func TestEventsEndpointDoesNotSynthesizeRetryScheduled(t *testing.T) {
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_failed", Data: map[string]any{"issue_id": "1", "attempt": float64(2)}})
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if !strings.Contains(body, "event: run_failed") {
		t.Fatalf("expected run_failed in SSE stream, got %q", body)
	}
	if strings.Contains(body, "event: retry_scheduled") {
		t.Fatalf("did not expect retry_scheduled in SSE stream when unpublished, got %q", body)
	}
}

func TestEventsEndpointStreamsRefreshLifecyclePair(t *testing.T) {
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_failed", Data: map[string]any{"issue_id": "1", "attempt": float64(2), "source": "refresh", "cause": "stalled_timeout", "error": "stalled run exceeded timeout"}})
		pubsub.Publish(observability.Event{Type: "retry_scheduled", Data: map[string]any{"issue_id": "1", "attempt": float64(2), "due_at": "2026-01-01T00:00:00Z", "source": "refresh", "cause": "stalled_timeout"}})
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	body := res.Body.String()
	if !strings.Contains(body, "event: run_failed") {
		t.Fatalf("expected run_failed in SSE stream, got %q", body)
	}
	if !strings.Contains(body, "event: retry_scheduled") {
		t.Fatalf("expected retry_scheduled in SSE stream, got %q", body)
	}
	if !strings.Contains(body, "\"source\":\"refresh\"") {
		t.Fatalf("expected refresh source marker in SSE lifecycle payloads, got %q", body)
	}
	if !strings.Contains(body, "\"cause\":\"stalled_timeout\"") {
		t.Fatalf("expected refresh cause marker in SSE lifecycle payloads, got %q", body)
	}
}

func TestWriteEventEnvelopeWrapsRawPayloadWithTypeDataAndTimestamp(t *testing.T) {
	res := httptest.NewRecorder()
	writeEventEnvelope(res, "run_event", map[string]any{"issue_id": "1"})
	body := res.Body.String()

	if !strings.Contains(body, "event: run_event") {
		t.Fatalf("expected run_event SSE frame, got %q", body)
	}
	if !strings.Contains(body, "\"type\":\"run_event\"") {
		t.Fatalf("expected wrapped type field, got %q", body)
	}
	if !strings.Contains(body, "\"data\":{\"issue_id\":\"1\"}") {
		t.Fatalf("expected wrapped data field, got %q", body)
	}
	if !strings.Contains(body, "\"timestamp\":") {
		t.Fatalf("expected wrapped timestamp field, got %q", body)
	}
}

func TestWriteEventEnvelopePreservesProvidedEventTimestamp(t *testing.T) {
	res := httptest.NewRecorder()
	writeEventEnvelope(res, "run_event", observability.Event{Type: "run_event", Timestamp: "2026-01-01T00:00:00Z", Data: map[string]any{"issue_id": "1"}})
	body := res.Body.String()

	if !strings.Contains(body, "\"timestamp\":\"2026-01-01T00:00:00Z\"") {
		t.Fatalf("expected provided event timestamp to be preserved, got %q", body)
	}
}

func TestEventsEndpointNonSnapshotFramesUseStableEnvelopeShape(t *testing.T) {
	pubsub := observability.NewPubSub()
	router := NewRouterWithPubSub(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_event", Data: map[string]any{"issue_id": "1"}})
		pubsub.Publish(observability.Event{Type: "run_failed", Data: map[string]any{"issue_id": "1", "cause": "agent_run_failed"}})
		pubsub.Publish(observability.Event{Type: "retry_scheduled", Data: map[string]any{"issue_id": "1", "due_at": "2026-01-01T00:00:00Z"}})
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	frames := parseSSEFrames(res.Body.String())
	if len(frames) == 0 {
		t.Fatalf("expected SSE frames")
	}

	validated := 0
	for _, frame := range frames {
		if frame.Event == "snapshot" || frame.Event == "error" {
			continue
		}
		payload := map[string]any{}
		if err := json.Unmarshal([]byte(frame.Data), &payload); err != nil {
			t.Fatalf("decode SSE payload for %s: %v (raw=%q)", frame.Event, err, frame.Data)
		}
		typeField, _ := payload["type"].(string)
		if typeField != frame.Event {
			t.Fatalf("expected envelope type %q to match SSE event %q, got %+v", frame.Event, frame.Event, payload)
		}
		if _, ok := payload["timestamp"].(string); !ok {
			t.Fatalf("expected timestamp field in envelope for %q, got %+v", frame.Event, payload)
		}
		if _, ok := payload["data"]; !ok {
			t.Fatalf("expected data field in envelope for %q, got %+v", frame.Event, payload)
		}
		validated++
	}

	if validated < 3 {
		t.Fatalf("expected to validate at least 3 non-snapshot frames, got %d", validated)
	}
}

func TestEventsEndpointSnapshotFrameCarriesExpectedShape(t *testing.T) {
	service := orchestrator.NewService()
	service.SetRunningForTest([]orchestrator.RunningEntry{{
		IssueID:         "1",
		IssueIdentifier: "ORC-1",
		State:           "In Progress",
		StartedAt:       time.Now().UTC().Format(time.RFC3339),
		LastEventAt:     time.Now().UTC().Format(time.RFC3339),
	}})
	service.SetRetryingForTest([]orchestrator.RetryEntry{{
		IssueID:         "2",
		IssueIdentifier: "ORC-2",
		Attempt:         1,
		DueAt:           "2026-01-01T00:00:00Z",
		Error:           "transient",
	}})
	service.RecordRunEvent("1", agents.Event{
		Kind:      "thread/rate_limits",
		Timestamp: time.Now().UTC(),
		Raw:       map[string]any{"rate_limits": map[string]any{"remaining": 6}},
	})

	router := NewRouter(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events?once=1", nil)
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)

	frames := parseSSEFrames(res.Body.String())
	if len(frames) == 0 {
		t.Fatalf("expected snapshot frame")
	}
	if frames[0].Event != "snapshot" {
		t.Fatalf("expected first frame to be snapshot, got %q", frames[0].Event)
	}

	payload := map[string]any{}
	if err := json.Unmarshal([]byte(frames[0].Data), &payload); err != nil {
		t.Fatalf("decode snapshot payload: %v", err)
	}
	if _, ok := payload["generated_at"].(string); !ok {
		t.Fatalf("expected generated_at in snapshot payload, got %+v", payload)
	}
	counts, ok := payload["counts"].(map[string]any)
	if !ok {
		t.Fatalf("expected counts object in snapshot payload, got %+v", payload)
	}
	if counts["running"] != float64(1) || counts["retrying"] != float64(1) {
		t.Fatalf("unexpected counts in snapshot payload: %+v", counts)
	}
	if _, ok := payload["running"].([]any); !ok {
		t.Fatalf("expected running array in snapshot payload, got %+v", payload)
	}
	if _, ok := payload["retrying"].([]any); !ok {
		t.Fatalf("expected retrying array in snapshot payload, got %+v", payload)
	}
	if _, ok := payload["codex_totals"].(map[string]any); !ok {
		t.Fatalf("expected codex_totals object in snapshot payload, got %+v", payload)
	}
	rateLimits, ok := payload["rate_limits"].(map[string]any)
	if !ok {
		t.Fatalf("expected rate_limits object in snapshot payload, got %+v", payload)
	}
	if rateLimits["remaining"] != float64(6) && rateLimits["remaining"] != 6 {
		t.Fatalf("unexpected rate_limits payload: %+v", rateLimits)
	}
}

func TestEventsEndpointLifecycleEnvelopeCarriesExpectedDataFields(t *testing.T) {
	pubsub := observability.NewPubSub()
	service := orchestrator.NewService()
	router := NewRouterWithPubSub(zerolog.Nop(), service, &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""}, pubsub, nil)

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	res := httptest.NewRecorder()

	go func() {
		time.Sleep(50 * time.Millisecond)
		pubsub.Publish(observability.Event{Type: "run_failed", Data: map[string]any{"issue_id": "1", "attempt": float64(2), "cause": "agent_run_failed", "error": "boom"}})
		pubsub.Publish(observability.Event{Type: "retry_scheduled", Data: map[string]any{"issue_id": "1", "attempt": float64(2), "cause": "agent_run_failed", "due_at": "2026-01-01T00:00:00Z"}})
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	router.ServeHTTP(res, req)
	frames := parseSSEFrames(res.Body.String())
	if len(frames) == 0 {
		t.Fatalf("expected lifecycle SSE frames")
	}

	seenRunFailed := false
	seenRetryScheduled := false
	for _, frame := range frames {
		if frame.Event != "run_failed" && frame.Event != "retry_scheduled" {
			continue
		}
		envelope := map[string]any{}
		if err := json.Unmarshal([]byte(frame.Data), &envelope); err != nil {
			t.Fatalf("decode %s envelope: %v", frame.Event, err)
		}
		data, ok := envelope["data"].(map[string]any)
		if !ok {
			t.Fatalf("expected %s data object, got %+v", frame.Event, envelope)
		}
		if data["issue_id"] != "1" {
			t.Fatalf("expected issue_id in %s data, got %+v", frame.Event, data)
		}
		if data["attempt"] != float64(2) {
			t.Fatalf("expected attempt in %s data, got %+v", frame.Event, data)
		}
		if data["cause"] != "agent_run_failed" {
			t.Fatalf("expected cause in %s data, got %+v", frame.Event, data)
		}
		if frame.Event == "run_failed" {
			if _, ok := data["error"].(string); !ok {
				t.Fatalf("expected error field in run_failed data, got %+v", data)
			}
			seenRunFailed = true
		}
		if frame.Event == "retry_scheduled" {
			if data["due_at"] != "2026-01-01T00:00:00Z" {
				t.Fatalf("expected due_at in retry_scheduled data, got %+v", data)
			}
			seenRetryScheduled = true
		}
	}

	if !seenRunFailed || !seenRetryScheduled {
		t.Fatalf("expected both run_failed and retry_scheduled frames, got run_failed=%v retry_scheduled=%v", seenRunFailed, seenRetryScheduled)
	}
}

func TestNotFoundReturnsJSONForAPIPaths(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/does-not-exist/extra", nil)
	router.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content type, got %q", ct)
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	errorNode, _ := payload["error"].(map[string]any)
	if errorNode["code"] != "not_found" {
		t.Fatalf("expected not_found error code, got %+v", payload)
	}
}

func TestNotFoundReturnsHTMLForNonAPIPaths(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/does-not-exist", nil)
	router.ServeHTTP(res, req)

	if res.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("expected html content type, got %q", ct)
	}
	if !strings.Contains(res.Body.String(), "404 Not Found") {
		t.Fatalf("expected html not-found body, got %q", res.Body.String())
	}
}

func TestMethodNotAllowedReturnsJSONForAPIPaths(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/state", nil)
	router.ServeHTTP(res, req)

	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content type, got %q", ct)
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	errorNode, _ := payload["error"].(map[string]any)
	if errorNode["code"] != "method_not_allowed" {
		t.Fatalf("expected method_not_allowed error code, got %+v", payload)
	}
}

func TestMethodNotAllowedReturnsHTMLForNonAPIPaths(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	router.ServeHTTP(res, req)

	if res.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "text/html") {
		t.Fatalf("expected html content type, got %q", ct)
	}
}

func TestPostAPIRejectsNonJSONContentType(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", strings.NewReader("ignored"))
	req.Header.Set("Content-Type", "text/plain")
	router.ServeHTTP(res, req)

	if res.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("expected 415, got %d", res.Code)
	}
	if ct := res.Header().Get("Content-Type"); !strings.Contains(ct, "application/json") {
		t.Fatalf("expected json content type, got %q", ct)
	}
	var payload map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode json: %v", err)
	}
	errorNode, _ := payload["error"].(map[string]any)
	if errorNode["code"] != "unsupported_media_type" {
		t.Fatalf("expected unsupported_media_type error code, got %+v", payload)
	}
}

func TestPostAPIAcceptsJSONContentType(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: ""})
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/refresh", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(res, req)

	if res.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", res.Code)
	}
}
