package diagnostics

import (
	"fmt"
	"regexp"
	"time"

	"go.opentelemetry.io/otel/attribute"
)

var routePattern = regexp.MustCompile(`^/(?:[A-Za-z0-9_.-]+|\{[A-Za-z_][A-Za-z0-9_]*\}|\*)(?:/(?:[A-Za-z0-9_.-]+|\{[A-Za-z_][A-Za-z0-9_]*\}|\*))*/*$`)

// HTTP records observed protocol metadata. route must be the router's registered
// template, never Request.URL.Path, RawPath or RawQuery. Unmatched routes are empty.
func (s *Span) HTTP(method, route string, statusCode int) {
	if s == nil || s.service == nil {
		return
	}
	switch method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "CONNECT", "OPTIONS", "TRACE":
	default:
		method = ""
	}
	if len(route) > 128 || (route != "/" && !routePattern.MatchString(route)) || credentialPattern.MatchString(route) {
		route = ""
	}
	if statusCode < 100 || statusCode > 599 {
		statusCode = 0
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ended {
		return
	}
	s.http = HTTPFields{HTTPMethod: method, HTTPRoute: route, HTTPStatusCode: statusCode}
	s.span.SetAttributes(attribute.String("http.request.method", method), attribute.String("http.route", route), attribute.Int("http.response.status_code", statusCode))
}

func (s *Span) eventDuration(name string) *float64 {
	if name != "http.completed" || s.started.IsZero() || s.http.HTTPStatusCode == 0 {
		return nil
	}
	elapsed := float64(time.Since(s.started)) / float64(time.Millisecond)
	return &elapsed
}

// Labels are presentation metadata derived from fixed names, never request or
// provider content. Historical records retain absent protocol evidence.
func describe(name string, http HTTPFields) (string, string) {
	if name == "http.request" || name == "http.completed" {
		label := "API request"
		if http.HTTPMethod != "" && http.HTTPRoute != "" {
			label = http.HTTPMethod + " " + http.HTTPRoute
		}
		description := "HTTP request observed by Orchestra. Response status was not recorded."
		if http.HTTPStatusCode != 0 {
			description = fmt.Sprintf("HTTP request returned status %d.", http.HTTPStatusCode)
		}
		if http.HTTPRoute == "" {
			description += " Route template was not recorded."
		}
		return label, description
	}
	if value, ok := operationDescriptions[name]; ok {
		return value[0], value[1]
	}
	return name, "Recorded operation or event; no additional description is registered."
}

var operationDescriptions = map[string][2]string{
	"task.run":                 {"Task run", "Task execution lifecycle observed by Orchestra."},
	"task.attempt":             {"Task attempt", "One task execution attempt, including preparation and provider work."},
	"task.prepare":             {"Prepare task", "Preparation of the task workspace and execution context."},
	"task.finalize":            {"Finalize task", "Task result processing and finalization effects."},
	"provider.call":            {"Provider call", "Invocation of the selected provider for task execution."},
	"provider.turn":            {"Provider turn", "Provider work associated with one conversation turn."},
	"provider.startup":         {"Start provider", "Provider session startup observed by Orchestra."},
	"provider.tool":            {"Provider tool", "Tool activity reported by the provider; arguments and results are excluded."},
	"tool.execute":             {"Execute tool", "Execution of an Orchestra tool; inputs and results are excluded."},
	"tool.started":             {"Tool started", "A tool operation was observed starting."},
	"approval.wait":            {"Wait for approval", "Time spent waiting for an approval response."},
	"approval.requested":       {"Approval requested", "An approval request was observed."},
	"approval.responded":       {"Approval response", "An approval response was observed; this event alone does not identify the decision."},
	"chat.turn":                {"Conversation turn", "One accepted conversation turn and its observed lifecycle."},
	"chat.accepted":            {"Message accepted", "Orchestra accepted a conversation turn; provider completion is tracked separately."},
	"chat.completed":           {"Conversation completed", "The conversation turn reported completion."},
	"chat.failed":              {"Conversation failed", "The conversation turn reported failure."},
	"chat.cancelled":           {"Conversation cancelled", "The conversation turn reported cancellation."},
	"chat.unknown":             {"Conversation outcome unknown", "The conversation turn's terminal outcome could not be established."},
	"feature.chat.send":        {"Message sent", "Use of the conversation send operation was recorded."},
	"feature.task.dispatch":    {"Task dispatched", "Use of the task dispatch operation was recorded."},
	"task.failed":              {"Task failed", "The task attempt reported failure."},
	"task.retry.scheduled":     {"Retry scheduled", "A later task attempt was scheduled after failure."},
	"task.result.discarded":    {"Result discarded", "A task result was discarded because its execution ownership was no longer current."},
	"task.commit.failed":       {"Commit failed", "Task finalization could not create its commit."},
	"task.push.failed":         {"Push failed", "Task finalization could not publish repository changes."},
	"task.plan.persist.failed": {"Plan save failed", "Task finalization could not persist its plan."},
	"task.state.update.failed": {"State update failed", "Task finalization could not persist its state transition."},
}
