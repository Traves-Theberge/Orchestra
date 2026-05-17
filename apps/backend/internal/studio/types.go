// apps/backend/internal/studio/types.go
package studio

import "time"

type Status string

const (
	StatusActive    Status = "active"
	StatusPushed    Status = "pushed"
	StatusDiscarded Status = "discarded"
)

type EventKind string

const (
	EventChatMessage   EventKind = "chat.message"
	EventChatToken     EventKind = "chat.token"
	EventToolCall      EventKind = "tool.call"
	EventDraftUpdated  EventKind = "draft.updated"
	EventSessionStatus EventKind = "session.status"
	EventError         EventKind = "error"
)

type Event struct {
	SessionID string      `json:"session_id"`
	Kind      EventKind   `json:"kind"`
	Payload   interface{} `json:"payload"`
	Timestamp time.Time   `json:"timestamp"`
}

type DraftSnapshot struct {
	SessionID          string                 `json:"session_id"`
	Title              string                 `json:"title"`
	Description        string                 `json:"description"`
	AcceptanceCriteria []string               `json:"acceptance_criteria"`
	Attachments        []Attachment           `json:"attachments"`
	SuggestedProvider  string                 `json:"suggested_provider"`
	SuggestedModel     string                 `json:"suggested_model"`
	MaxTurns           *int                   `json:"max_turns,omitempty"`
	TemplateName       string                 `json:"template_name,omitempty"`
	TemplateVars       map[string]string      `json:"template_vars"`
	AgentGuidance      map[string]interface{} `json:"agent_guidance"`
}

type Attachment struct {
	Kind  string `json:"kind"` // "file" | "link"
	Path  string `json:"path,omitempty"`
	URL   string `json:"url,omitempty"`
	Label string `json:"label,omitempty"`
}

type Session struct {
	ID        string
	ProjectID string
	Runner    string
	RepoPath  string // absolute path to the project's git repository
	Status    Status
}

type StartSessionRequest struct {
	ProjectID    string            `json:"project_id"`
	Runner       string            `json:"runner"`
	Template     string            `json:"template,omitempty"`
	TemplateVars map[string]string `json:"template_vars,omitempty"`
}
