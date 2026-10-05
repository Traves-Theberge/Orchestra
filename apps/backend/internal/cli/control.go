package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func controlRequest(ctx context.Context, client *http.Client, base *url.URL, token string, c command) (any, string, error) {
	args := map[string]string{"operation": strings.TrimPrefix(strings.TrimPrefix(c.name, "task "), "control ")}
	if c.name == "task assign" {
		args["expected_state"] = "Backlog"
	}
	if c.requestID != "" {
		args["request_id"] = c.requestID
	}
	for key, value := range map[string]string{"project_id": c.project, "task_id": c.id, "expected_state": c.expectedState, "title": c.title, "description": c.description, "assignee_id": c.assignee, "provider": c.provider} {
		if value != "" {
			args[key] = value
		}
	}
	raw, _ := json.Marshal(args)
	u := *base
	u.Path = "/api/v1/orchestrator/control"
	u.RawPath = ""
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(raw))
	if err != nil {
		return nil, "invalid_request", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, "mutation_unknown", errors.New("request outcome unknown; retain request_id and inspect control receipt/project tasks before repeating")
	}
	defer resp.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(raw) > maxResponseBytes {
		return nil, "mutation_unknown", errors.New("control result unreadable; retain request_id and inspect receipt before repeating")
	}
	var result struct {
		Success bool `json:"success"`
		Error   struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &result) != nil {
		return nil, "invalid_response", errors.New("control result not JSON; inspect request identity before repeating")
	}
	if !result.Success || resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if result.Error.Code == "" {
			result.Error.Code = "http_error"
		}
		if result.Error.Message == "" {
			result.Error.Message = "backend rejected control request; no automatic retry"
		}
		return nil, result.Error.Code, errors.New(strings.ReplaceAll(result.Error.Message, token, "[redacted]"))
	}
	var data any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&data); err != nil {
		return nil, "invalid_response", err
	}
	return data, "", nil
}
