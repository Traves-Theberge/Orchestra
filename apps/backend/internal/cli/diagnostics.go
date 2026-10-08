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
	"strconv"
	"strings"
	"time"
)

type diagnosticCommand struct {
	action, traceID, baseURL string
	jsonOutput               bool
	query                    url.Values
}

// Diagnostic observations deliberately do not resolve projects through the tracker.
// Historical diagnostic identity remains queryable after a project leaves the catalog.
func parseDiagnostics(args []string) (diagnosticCommand, error) {
	c := diagnosticCommand{query: url.Values{}}
	if len(args) < 2 {
		return c, errors.New("use diagnostics overview|traces|trace <trace-id>|logs|settings|export|check")
	}
	c.action = args[1]
	switch c.action {
	case "overview", "traces", "trace", "logs", "settings", "export", "check":
	default:
		return c, errors.New("unknown diagnostics command; only read-only observations are supported")
	}
	seen := map[string]bool{}
	for args = args[2:]; len(args) > 0; {
		arg := args[0]
		args = args[1:]
		if c.action == "trace" && !strings.HasPrefix(arg, "-") && c.traceID == "" {
			c.traceID = arg
			continue
		}
		if seen[arg] {
			return c, fmt.Errorf("duplicate %s", arg)
		}
		seen[arg] = true
		if arg == "--json" {
			c.jsonOutput = true
			continue
		}
		if len(args) == 0 || strings.HasPrefix(args[0], "--") {
			return c, errors.New("option requires a value")
		}
		value := args[0]
		args = args[1:]
		if strings.TrimSpace(value) == "" {
			return c, errors.New("empty option value")
		}
		if arg == "--base-url" {
			c.baseURL = value
			continue
		}
		if c.action == "trace" || c.action == "settings" || c.action == "check" {
			return c, errors.New("this diagnostics command accepts only --json and --base-url")
		}
		key := ""
		bound := 200
		switch arg {
		case "--project":
			key = "project_id"
			bound = 128
		case "--task":
			key = "task_id"
			bound = 128
		case "--provider":
			key = "provider"
			bound = 96
		case "--search":
			key = "q"
			bound = 128
		case "--status":
			key = "status"
			switch value {
			case "running", "ok", "error", "cancelled", "unknown":
			default:
				return c, errors.New("status must be running, ok, error, cancelled or unknown")
			}
		case "--severity":
			if c.action != "logs" {
				return c, errors.New("--severity is only supported by diagnostics logs")
			}
			key = "severity"
			switch value {
			case "debug", "info", "warn", "error":
			default:
				return c, errors.New("severity must be debug, info, warn or error")
			}
		case "--since", "--until":
			key = strings.TrimPrefix(arg, "--")
			if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
				return c, errors.New("since/until require RFC3339 timestamps with a timezone")
			}
		case "--limit", "--offset":
			if c.action != "logs" && c.action != "traces" {
				return c, errors.New("--limit and --offset are only supported by diagnostics logs/traces")
			}
			key = strings.TrimPrefix(arg, "--")
			n, err := strconv.Atoi(value)
			if err != nil || (key == "limit" && (n < 1 || n > 500)) || (key == "offset" && (n < 0 || n > 1000000)) {
				return c, errors.New("limit must be 1..500; offset must be 0..1000000")
			}
		default:
			return c, errors.New("unknown option or unexpected positional argument")
		}
		if len(value) > bound {
			return c, fmt.Errorf("%s exceeds the API's %d-byte bound", arg, bound)
		}
		c.query.Set(key, value)
	}
	if c.action == "trace" {
		raw, err := hex.DecodeString(c.traceID)
		if err != nil || len(raw) != 16 || c.traceID != strings.ToLower(c.traceID) {
			return c, errors.New("trace requires the exact 32 lowercase hexadecimal trace ID")
		}
	}
	if c.query.Get("since") != "" && c.query.Get("until") != "" {
		since, _ := time.Parse(time.RFC3339Nano, c.query.Get("since"))
		until, _ := time.Parse(time.RFC3339Nano, c.query.Get("until"))
		if since.After(until) {
			return c, errors.New("since must not be later than until")
		}
	}
	return c, nil
}

func runDiagnostics(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	c, err := parseDiagnostics(args)
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
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	var data any
	var code string
	if c.action == "check" {
		var settings, overview map[string]any
		settings, code, err = diagnosticRequest(ctx, client, base, token, "settings", url.Values{}, "")
		if err == nil {
			overview, code, err = diagnosticRequest(ctx, client, base, token, "overview", url.Values{}, "")
		}
		if err == nil {
			data = diagnosticHealth(settings, overview)
		}
	} else {
		data, code, err = diagnosticRequest(ctx, client, base, token, c.action, c.query, c.traceID)
	}
	if err != nil {
		return fail(stderr, code, strings.ReplaceAll(err.Error(), token, "[REDACTED]"), 1)
	}
	scope := map[string]string{"source": "local_diagnostics", "backend_base_url": base.Scheme + "://" + base.Host}
	for key, values := range c.query {
		scope[key] = values[0]
	}
	if c.traceID != "" {
		scope["trace_id"] = c.traceID
	}
	output := redact(envelope{1, "diagnostics " + c.action, scope, data}, token)
	if c.jsonOutput {
		err = json.NewEncoder(stdout).Encode(output)
	} else {
		clean := output.(map[string]any)
		err = writeDiagnosticsHuman(stdout, c, clean["data"].(map[string]any), clean["scope"].(map[string]any))
	}
	if err != nil {
		return fail(stderr, "output_failed", "could not write diagnostics output", 1)
	}
	return 0
}

func diagnosticRequest(ctx context.Context, client *http.Client, base *url.URL, token, action string, query url.Values, traceID string) (map[string]any, string, error) {
	u := *base
	u.Path = "/api/v1/diagnostics/" + action
	u.RawPath = ""
	u.RawQuery = query.Encode()
	if action == "trace" {
		u.Path = "/api/v1/diagnostics/traces/" + traceID
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, "request_failed", errors.New("could not construct diagnostics request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "request_failed", errors.New("diagnostics request failed or timed out; check the selected backend connection")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, "invalid_response", errors.New("could not read diagnostics response")
	}
	if len(raw) > maxResponseBytes {
		return nil, "response_too_large", errors.New("diagnostics response exceeds 8 MiB")
	}
	if resp.StatusCode != http.StatusOK {
		var backend struct {
			Error struct {
				Code    string `json:"code"`
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &backend)
		switch resp.StatusCode {
		case 401, 403:
			return nil, "unauthorized", errors.New("backend rejected authentication; check the selected backend API token")
		case 404:
			if action == "trace" && backend.Error.Code == "trace_not_found" {
				return nil, "trace_not_found", errors.New("no retained diagnostic trace matches the exact trace ID")
			}
			return nil, "incompatible_backend", errors.New("diagnostics route is unavailable; the selected backend may be old or incompatible")
		case 503:
			return nil, "diagnostics_unavailable", errors.New("local diagnostics store is unavailable on the selected backend")
		default:
			return nil, "http_error", fmt.Errorf("backend returned HTTP %d; no response body was printed", resp.StatusCode)
		}
	}
	var data map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if dec.Decode(&data) != nil || data == nil || dec.Decode(new(any)) != io.EOF {
		return nil, "invalid_response", errors.New("expected one diagnostics JSON object")
	}
	if err = validateDiagnosticData(action, data, traceID); err != nil {
		return nil, "invalid_response", err
	}
	return data, "", nil
}

func diagnosticNumber(obj map[string]any, key string) (int64, bool) {
	n, ok := obj[key].(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil && i >= 0
}

func validateDiagnosticData(action string, data map[string]any, traceID string) error {
	invalid := errors.New("diagnostics response is missing required fields or has invalid field types")
	numbers := func(keys ...string) bool {
		for _, key := range keys {
			if _, ok := diagnosticNumber(data, key); !ok {
				return false
			}
		}
		return true
	}
	arrays := func(keys ...string) bool {
		for _, key := range keys {
			a, ok := data[key].([]any)
			if !ok {
				return false
			}
			for _, v := range a {
				if _, ok := v.(map[string]any); !ok {
					return false
				}
			}
		}
		return true
	}
	switch action {
	case "settings":
		if _, ok := data["enabled"].(bool); !ok || !numbers("retention_days", "metrics_retention_days", "max_storage_mb") {
			return invalid
		}
	case "overview":
		settings, ok := data["settings"].(map[string]any)
		if !ok || !numbers("total_traces", "failed_traces", "active_traces", "dropped_records", "storage_bytes", "queue_depth") {
			return invalid
		}
		if _, ok := settings["enabled"].(bool); !ok {
			return invalid
		}
		for _, key := range []string{"operations", "usage", "points", "features"} {
			if _, present := data[key]; present && !arrays(key) {
				return invalid
			}
		}
	case "traces", "logs":
		if !arrays("items") || !numbers("total", "limit", "offset") {
			return invalid
		}
		limit, _ := diagnosticNumber(data, "limit")
		offset, _ := diagnosticNumber(data, "offset")
		if limit < 1 || limit > 500 || offset > 1000000 || int64(len(data["items"].([]any))) > limit {
			return invalid
		}
	case "trace":
		trace, ok := data["trace"].(map[string]any)
		if !ok || trace["trace_id"] != traceID || !arrays("spans", "logs") {
			return invalid
		}
		if _, ok := data["partial"].(bool); !ok {
			return invalid
		}
		for _, key := range []string{"spans", "logs"} {
			for _, v := range data[key].([]any) {
				if v.(map[string]any)["trace_id"] != traceID {
					return errors.New("backend returned records outside the requested trace")
				}
			}
		}
	case "export":
		if !arrays("traces", "spans", "logs") {
			return invalid
		}
		if _, ok := data["truncated"].(bool); !ok {
			return invalid
		}
		version, ok := diagnosticNumber(data, "schema_version")
		if !ok || version != 1 {
			return errors.New("unsupported diagnostic export schema version")
		}
		if _, ok := data["exported_at"].(string); !ok {
			return invalid
		}
	}
	return nil
}

func diagnosticHealth(settings, overview map[string]any) map[string]any {
	enabled := settings["enabled"] == true
	state := "collecting"
	warnings := []string{}
	if !enabled {
		state = "disabled"
		warnings = append(warnings, "Collection is intentionally disabled in settings; retained history remains queryable.")
	}
	drops, _ := diagnosticNumber(overview, "dropped_records")
	if drops > 0 {
		warnings = append(warnings, "Dropped records indicate historical gaps in this backend process; this counter does not prove an ongoing failure.")
	}
	queue, _ := diagnosticNumber(overview, "queue_depth")
	if queue > 0 {
		warnings = append(warnings, "Queued records await persistence; a single snapshot cannot establish whether the queue is stalled.")
	}
	storage, _ := diagnosticNumber(overview, "storage_bytes")
	budget, _ := diagnosticNumber(settings, "max_storage_mb")
	if budget > 0 && storage >= budget*1024*1024 {
		warnings = append(warnings, "Storage is at or above the configured budget; inspect retention and subsequent snapshots.")
	}
	if current, ok := overview["settings"].(map[string]any)["enabled"].(bool); !ok || current != enabled {
		warnings = append(warnings, "Collection settings changed or are incomplete between snapshots; repeat the read-only check.")
	}
	return map[string]any{"available": true, "collection_state": state, "history_gaps": drops > 0, "execution_verified": false, "settings": settings, "overview": overview, "queue_depth": overview["queue_depth"], "storage_bytes": overview["storage_bytes"], "dropped_records": overview["dropped_records"], "warnings": warnings, "assessment": "Settings and overview APIs responded. These separate snapshots do not verify end-to-end task or provider execution."}
}

func writeDiagnosticsHuman(out io.Writer, c diagnosticCommand, data, scope map[string]any) error {
	var b strings.Builder
	fmt.Fprintf(&b, "Local diagnostics — %s\nBackend: %s\n", c.action, diagnosticHuman(scope["backend_base_url"]))
	for _, key := range []string{"project_id", "task_id", "provider", "status", "severity", "q", "since", "until"} {
		if v, ok := scope[key]; ok {
			fmt.Fprintf(&b, "%s: %s\n", key, diagnosticHuman(v))
		}
	}
	switch c.action {
	case "check":
		fmt.Fprintf(&b, "Availability: available\nCollection: %s\nHistorical gaps: %t (%s dropped records)\nQueue: %s records awaiting persistence\nStorage: %s bytes\n", diagnosticHuman(data["collection_state"]), data["history_gaps"] == true, diagnosticHuman(data["dropped_records"]), diagnosticHuman(data["queue_depth"]), diagnosticHuman(data["storage_bytes"]))
		for _, v := range data["warnings"].([]any) {
			fmt.Fprintf(&b, "Notice: %s\n", diagnosticHuman(v))
		}
		fmt.Fprintln(&b, diagnosticHuman(data["assessment"]))
	case "settings":
		fmt.Fprintf(&b, "Collection enabled: %t\nDetail retention: %s days\nMetrics retention: %s days\nStorage budget: %s MiB\n", data["enabled"] == true, diagnosticHuman(data["retention_days"]), diagnosticHuman(data["metrics_retention_days"]), diagnosticHuman(data["max_storage_mb"]))
	case "overview":
		fmt.Fprintf(&b, "Retained traces: %s; failed: %s; active: %s\nDropped records: %s (historical gaps in this backend process)\nQueue depth: %s; storage: %s bytes\n", diagnosticHuman(data["total_traces"]), diagnosticHuman(data["failed_traces"]), diagnosticHuman(data["active_traces"]), diagnosticHuman(data["dropped_records"]), diagnosticHuman(data["queue_depth"]), diagnosticHuman(data["storage_bytes"]))
		if settings, ok := data["settings"].(map[string]any); ok {
			fmt.Fprintf(&b, "Collection enabled: %t\n", settings["enabled"] == true)
		}
		if data["detailed_scope"] == true {
			fmt.Fprintln(&b, "Metrics scope: retained matching detail (older expired detail is excluded).")
		} else {
			fmt.Fprintln(&b, "Metrics scope: retained aggregates; trace counts cover retained detail.")
		}
		for _, v := range diagnosticRows(data, "operations") {
			r := v.(map[string]any)
			fmt.Fprintf(&b, "  %s: %s operations, %s errors, %s ms average\n", diagnosticLabel(r), diagnosticHuman(r["count"]), diagnosticHuman(r["errors"]), diagnosticHuman(r["average_duration_ms"]))
		}
		for _, v := range diagnosticRows(data, "usage") {
			r := v.(map[string]any)
			fmt.Fprintf(&b, "  Usage %s / %s: %s input, %s output tokens; %s measured runs\n", diagnosticHuman(r["provider"]), diagnosticHuman(r["model"]), diagnosticHuman(r["input_tokens"]), diagnosticHuman(r["output_tokens"]), diagnosticHuman(r["known_runs"]))
		}
	case "logs", "traces":
		rows := diagnosticRows(data, "items")
		fmt.Fprintf(&b, "Showing %d of %s records; offset %s, limit %s\n", len(rows), diagnosticHuman(data["total"]), diagnosticHuman(data["offset"]), diagnosticHuman(data["limit"]))
		if len(rows) == 0 {
			fmt.Fprintln(&b, "No retained records match these filters.")
		}
		writeDiagnosticRows(&b, rows, c.action == "logs")
	case "trace":
		writeDiagnosticRows(&b, []any{data["trace"]}, false)
		fmt.Fprintf(&b, "Partial retained detail: %t\nSpans: %d; logs: %d\n", data["partial"] == true, len(diagnosticRows(data, "spans")), len(diagnosticRows(data, "logs")))
		writeDiagnosticRows(&b, diagnosticRows(data, "spans"), false)
		writeDiagnosticRows(&b, diagnosticRows(data, "logs"), true)
	case "export":
		fmt.Fprintf(&b, "Exported at: %s\nTraces: %d; spans: %d; logs: %d\nTruncated: %t\nUse --json to save the versioned envelope with full raw diagnostic records.\n", diagnosticHuman(data["exported_at"]), len(diagnosticRows(data, "traces")), len(diagnosticRows(data, "spans")), len(diagnosticRows(data, "logs")), data["truncated"] == true)
	}
	_, err := io.WriteString(out, b.String())
	return err
}

func diagnosticRows(data map[string]any, key string) []any { rows, _ := data[key].([]any); return rows }
func diagnosticHuman(value any) string {
	if n, ok := value.(json.Number); ok {
		return safeHuman(n.String())
	}
	return safeHuman(value)
}
func diagnosticLabel(r map[string]any) string {
	if label, ok := r["label"].(string); ok && label != "" {
		return diagnosticHuman(label)
	}
	name, _ := r["name"].(string)
	labels := map[string]string{"http.request": "Backend API request", "http.completed": "Backend API request completed", "chat.turn": "Provider chat turn", "task.run": "Task execution", "task.attempt": "Task execution attempt", "provider.request": "Provider request", "provider.turn": "Provider turn", "approval.wait": "Waiting for approval", "approval.resolved": "Approval decision received", "tool.call": "Tool call"}
	if label, ok := labels[name]; ok {
		return label
	}
	return diagnosticHuman(strings.ReplaceAll(strings.ReplaceAll(name, ".", " "), "_", " "))
}
func writeDiagnosticRows(b *strings.Builder, rows []any, isLog bool) {
	for _, v := range rows {
		r := v.(map[string]any)
		when, state := r["start_time"], r["status"]
		if isLog {
			when, state = r["timestamp"], r["severity"]
		}
		fmt.Fprintf(b, "  %s | %s | %s", diagnosticHuman(when), diagnosticHuman(state), diagnosticLabel(r))
		if method, ok := r["http_method"].(string); ok && method != "" {
			fmt.Fprintf(b, " | %s %s", diagnosticHuman(method), diagnosticHuman(r["http_route"]))
			if status, ok := r["http_status_code"]; ok {
				fmt.Fprintf(b, " | HTTP %s", diagnosticHuman(status))
			}
		}
		if duration, ok := r["duration_ms"]; ok {
			fmt.Fprintf(b, " | %s ms", diagnosticHuman(duration))
		}
		if task, ok := r["task_id"].(string); ok && task != "" {
			fmt.Fprintf(b, " | Task: %s", diagnosticHuman(task))
		} else if name, _ := r["name"].(string); strings.HasPrefix(name, "http.") {
			fmt.Fprint(b, " | API activity")
		}
		if provider, ok := r["provider"].(string); ok && provider != "" {
			fmt.Fprintf(b, " | Provider: %s", diagnosticHuman(provider))
		}
		fmt.Fprintln(b)
		if desc, ok := r["description"].(string); ok && desc != "" {
			fmt.Fprintf(b, "    %s\n", diagnosticHuman(desc))
		}
		if id, ok := r["trace_id"].(string); ok && id != "" {
			fmt.Fprintf(b, "    Trace: %s\n", diagnosticHuman(id))
		}
	}
}
