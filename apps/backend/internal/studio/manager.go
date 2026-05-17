package studio

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/observability"
	"github.com/orchestra/orchestra/apps/backend/internal/studio/templates"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// RunnerSpawner abstracts the CLI agent spawn used by a studio session.
// Phase 1 uses a fake; Phase 2 wires real CLI runners.
type RunnerSpawner interface {
	Spawn(ctx context.Context, sess Session, onEvent func(Event)) error
	SendMessage(ctx context.Context, sessionID, message string) error
	Stop(sessionID string) error
}

// Tracker is the subset of tracker.Client that Manager needs to push a draft to the backlog.
type Tracker interface {
	CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID, provider string, disabledTools []string) (*tracker.Issue, error)
	UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error)
}

type Manager struct {
	d             *sql.DB
	bus           *observability.PubSub
	spawner       RunnerSpawner
	tracker       Tracker
	templateStore *templates.Store
	mu            sync.Mutex // guards read-modify-write draft operations
}

func NewManager(d *sql.DB, bus *observability.PubSub, spawner RunnerSpawner) *Manager {
	return &Manager{d: d, bus: bus, spawner: spawner}
}

// SetTracker configures the tracker backend used by Push.
func (m *Manager) SetTracker(t Tracker) {
	m.tracker = t
}

// SetTemplateStore configures the template store used by ApplyTemplate and
// StartSession's template hook. Nil disables template features.
func (m *Manager) SetTemplateStore(s *templates.Store) {
	m.templateStore = s
}

// ApplyTemplate loads the named template, renders its body with the given
// vars, and applies the rendered body plus any suggested provider/model/turns
// to the draft. Validates required variables before mutating.
func (m *Manager) ApplyTemplate(sessionID, name string, vars map[string]string) error {
	if m.templateStore == nil {
		return fmt.Errorf("studio: template store not configured")
	}
	tpl, err := m.templateStore.Get(name)
	if err != nil {
		return fmt.Errorf("get template: %w", err)
	}
	if err := templates.Validate(tpl, vars); err != nil {
		return err
	}
	rendered, err := templates.Render(tpl.Body, vars)
	if err != nil {
		return err
	}

	if tpl.Meta.SuggestedProvider != "" {
		if err := m.SetProvider(sessionID, tpl.Meta.SuggestedProvider); err != nil {
			return err
		}
	}
	if tpl.Meta.SuggestedModel != "" {
		if err := m.SetModel(sessionID, tpl.Meta.SuggestedModel); err != nil {
			return err
		}
	}
	if tpl.Meta.SuggestedMaxTurns > 0 {
		if err := m.SetMaxTurns(sessionID, tpl.Meta.SuggestedMaxTurns); err != nil {
			return err
		}
	}
	if err := db.UpdateDraftField(m.d, sessionID, "template_name", name); err != nil {
		return err
	}
	varsJSON, _ := json.Marshal(vars)
	if err := db.UpdateDraftField(m.d, sessionID, "template_vars", string(varsJSON)); err != nil {
		return err
	}
	return m.SetDescription(sessionID, rendered)
}

func (m *Manager) StartSession(ctx context.Context, req StartSessionRequest) (Session, error) {
	if req.Runner == "" {
		return Session{}, fmt.Errorf("studio: runner required")
	}
	id := "studio-" + uuid.NewString()
	row := db.StudioSession{ID: id, ProjectID: req.ProjectID, Runner: req.Runner}
	if err := db.CreateStudioSession(m.d, row); err != nil {
		return Session{}, fmt.Errorf("create session: %w", err)
	}
	if err := db.CreateDraft(m.d, id); err != nil {
		return Session{}, fmt.Errorf("create draft: %w", err)
	}
	var repoPath string
	if req.ProjectID != "" {
		_ = m.d.QueryRowContext(ctx, `SELECT root_path FROM projects WHERE id = ?`, req.ProjectID).Scan(&repoPath)
	}
	sess := Session{ID: id, ProjectID: req.ProjectID, Runner: req.Runner, RepoPath: repoPath, Status: StatusActive}
	if req.Template != "" {
		if err := m.ApplyTemplate(id, req.Template, req.TemplateVars); err != nil {
			_ = db.DeleteDraft(m.d, id)
			_ = db.EndStudioSession(m.d, id, string(StatusDiscarded))
			return Session{}, fmt.Errorf("apply template: %w", err)
		}
	}
	if m.spawner != nil {
		if err := m.spawner.Spawn(ctx, sess, m.dispatch); err != nil {
			_ = db.DeleteDraft(m.d, id)
			_ = db.EndStudioSession(m.d, id, string(StatusDiscarded))
			return Session{}, fmt.Errorf("spawn runner: %w", err)
		}
	}
	return sess, nil
}

// SendMessage forwards a user message to the runner attached to this session.
// It prepends a task-authoring system prompt so the agent knows its role and
// the MCP tools available to it via the orchestra-studio server.
func (m *Manager) SendMessage(ctx context.Context, sessionID, msg string) error {
	if m.spawner == nil {
		return fmt.Errorf("studio: no runner attached")
	}
	draft, _ := m.GetDraft(sessionID)
	full := buildStudioPrompt(draft, msg)
	return m.spawner.SendMessage(ctx, sessionID, full)
}

// ApplyDraftPatch applies a map of field updates to the draft for a session.
// Supported keys: title, description, suggested_provider, suggested_model, max_turns.
func (m *Manager) ApplyDraftPatch(sessionID string, patch map[string]interface{}) error {
	for k, v := range patch {
		switch k {
		case "title":
			s, _ := v.(string)
			if err := m.SetTitle(sessionID, s); err != nil {
				return err
			}
		case "description":
			s, _ := v.(string)
			if err := m.SetDescription(sessionID, s); err != nil {
				return err
			}
		case "suggested_provider":
			s, _ := v.(string)
			if err := m.SetProvider(sessionID, s); err != nil {
				return err
			}
		case "suggested_model":
			s, _ := v.(string)
			if err := m.SetModel(sessionID, s); err != nil {
				return err
			}
		case "max_turns":
			switch x := v.(type) {
			case float64:
				if err := m.SetMaxTurns(sessionID, int(x)); err != nil {
					return err
				}
			case int:
				if err := m.SetMaxTurns(sessionID, x); err != nil {
					return err
				}
			default:
				return fmt.Errorf("studio: max_turns must be a number")
			}
		default:
			return fmt.Errorf("studio: field not patchable: %q", k)
		}
	}
	return nil
}

func (m *Manager) Discard(sessionID string) error {
	if m.spawner != nil {
		_ = m.spawner.Stop(sessionID)
	}
	if err := db.DeleteDraft(m.d, sessionID); err != nil {
		return err
	}
	return db.EndStudioSession(m.d, sessionID, string(StatusDiscarded))
}

// Push validates the draft, creates a backlog issue via the configured tracker,
// persists studio-specific fields, then closes out the session.
// Returns the new issue's identifier.
func (m *Manager) Push(ctx context.Context, sessionID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return "", err
	}
	if snap.Title == "" {
		return "", fmt.Errorf("studio: title required")
	}
	if snap.Description == "" {
		return "", fmt.Errorf("studio: description required")
	}
	if m.tracker == nil {
		return "", fmt.Errorf("studio: tracker not configured")
	}

	sess, err := db.GetStudioSession(m.d, sessionID)
	if err != nil {
		return "", fmt.Errorf("get session: %w", err)
	}

	// Initial create with the core fields the tracker interface supports.
	state := "Backlog"
	priority := 0
	issue, err := m.tracker.CreateIssue(
		ctx,
		snap.Title, snap.Description, state, priority,
		"", sess.ProjectID, snap.SuggestedProvider, nil,
	)
	if err != nil {
		return "", fmt.Errorf("create issue: %w", err)
	}

	// Persist studio-specific fields via UpdateIssue.
	acJSON, _ := json.Marshal(snap.AcceptanceCriteria)
	attJSON, _ := json.Marshal(snap.Attachments)
	guidanceJSON, _ := json.Marshal(snap.AgentGuidance)
	updates := map[string]any{
		"acceptance_criteria":  string(acJSON),
		"attachments":          string(attJSON),
		"agent_guidance":       string(guidanceJSON),
		"authoring_session_id": sessionID,
	}
	if snap.TemplateName != "" {
		updates["source_template"] = snap.TemplateName
	}
	if _, err := m.tracker.UpdateIssue(ctx, issue.Identifier, updates); err != nil {
		return "", fmt.Errorf("update issue with studio fields: %w", err)
	}

	_ = db.DeleteDraft(m.d, sessionID)
	_ = db.EndStudioSession(m.d, sessionID, string(StatusPushed))
	if m.spawner != nil {
		_ = m.spawner.Stop(sessionID)
	}
	m.dispatch(Event{
		SessionID: sessionID,
		Kind:      EventSessionStatus,
		Payload:   map[string]string{"status": string(StatusPushed), "issue_id": issue.Identifier},
	})
	return issue.Identifier, nil
}

func (m *Manager) GetDraft(sessionID string) (DraftSnapshot, error) {
	d2, err := db.GetDraft(m.d, sessionID)
	if err != nil {
		return DraftSnapshot{}, err
	}
	return toSnapshot(d2)
}

func (m *Manager) dispatch(ev Event) {
	if m.bus == nil {
		return
	}
	m.bus.Publish(observability.Event{
		Type: "studio." + ev.SessionID,
		Data: ev,
	})
}

func (m *Manager) SetTitle(sessionID, title string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "title", title); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetDescription(sessionID, desc string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "description", desc); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) AddAcceptanceCriterion(sessionID, criterion string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	snap.AcceptanceCriteria = append(snap.AcceptanceCriteria, criterion)
	raw, _ := json.Marshal(snap.AcceptanceCriteria)
	if err := db.UpdateDraftField(m.d, sessionID, "acceptance_criteria", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) RemoveAcceptanceCriterion(sessionID string, index int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	if index < 0 || index >= len(snap.AcceptanceCriteria) {
		return fmt.Errorf("studio: ac index out of range: %d", index)
	}
	snap.AcceptanceCriteria = append(snap.AcceptanceCriteria[:index], snap.AcceptanceCriteria[index+1:]...)
	raw, _ := json.Marshal(snap.AcceptanceCriteria)
	if err := db.UpdateDraftField(m.d, sessionID, "acceptance_criteria", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) AttachFile(sessionID, path string) error {
	return m.addAttachment(sessionID, Attachment{Kind: "file", Path: path})
}

func (m *Manager) AttachLink(sessionID, url, label string) error {
	return m.addAttachment(sessionID, Attachment{Kind: "link", URL: url, Label: label})
}

func (m *Manager) addAttachment(sessionID string, a Attachment) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return err
	}
	snap.Attachments = append(snap.Attachments, a)
	raw, _ := json.Marshal(snap.Attachments)
	if err := db.UpdateDraftField(m.d, sessionID, "attachments", string(raw)); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetProvider(sessionID, provider string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "suggested_provider", provider); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetModel(sessionID, model string) error {
	if err := db.UpdateDraftField(m.d, sessionID, "suggested_model", model); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) SetMaxTurns(sessionID string, turns int) error {
	if err := db.UpdateDraftField(m.d, sessionID, "max_turns", turns); err != nil {
		return err
	}
	m.publishDraftUpdate(sessionID)
	return nil
}

func (m *Manager) publishDraftUpdate(sessionID string) {
	snap, err := m.GetDraft(sessionID)
	if err != nil {
		return
	}
	m.dispatch(Event{SessionID: sessionID, Kind: EventDraftUpdated, Payload: snap})
}

// buildStudioPrompt wraps the user's message with task-authoring context so the
// agent understands its role and the MCP tools it can use to update the draft.
func buildStudioPrompt(draft DraftSnapshot, userMsg string) string {
	var b strings.Builder

	b.WriteString(`You are a task-authoring assistant embedded in Orchestra, a multi-agent software development platform.

Your job is to help the user write a clear, well-scoped backlog task. You have read-only access to the project codebase so you can ground your suggestions in the actual code.

## Your MCP tools (orchestra-studio server)

Use these to update the task draft in real time as you learn what the user wants:
- mcp__orchestra-studio__set_title         — set a short, clear task title
- mcp__orchestra-studio__set_description   — write a detailed markdown description
- mcp__orchestra-studio__add_acceptance_criterion   — add a specific, testable AC
- mcp__orchestra-studio__remove_acceptance_criterion — remove an AC by index (0-based)

Update the draft progressively as the conversation develops. The user sees the draft panel update live.

## How to behave

1. Ask one clarifying question at a time if the request is vague.
2. Read relevant source files to understand the codebase before writing descriptions.
3. Write the title first, then description, then ACs as your understanding solidifies.
4. Keep descriptions concrete — include file paths, function names, and technical detail where known.
5. Acceptance criteria should be independently verifiable (e.g. "Given X, when Y, then Z").

`)

	// Include current draft state so the agent knows what's already set.
	b.WriteString("## Current draft state\n\n")
	if draft.Title != "" {
		b.WriteString("Title: " + draft.Title + "\n")
	} else {
		b.WriteString("Title: (not set)\n")
	}
	if draft.Description != "" {
		b.WriteString("Description:\n" + draft.Description + "\n")
	} else {
		b.WriteString("Description: (not set)\n")
	}
	if len(draft.AcceptanceCriteria) > 0 {
		b.WriteString("Acceptance criteria:\n")
		for i, ac := range draft.AcceptanceCriteria {
			b.WriteString(fmt.Sprintf("  [%d] %s\n", i, ac))
		}
	} else {
		b.WriteString("Acceptance criteria: (none yet)\n")
	}

	b.WriteString("\n## User message\n\n")
	b.WriteString(userMsg)

	return b.String()
}

func toSnapshot(d2 db.IssueDraft) (DraftSnapshot, error) {
	s := DraftSnapshot{
		SessionID:         d2.SessionID,
		Title:             d2.Title,
		Description:       d2.Description,
		SuggestedProvider: d2.SuggestedProvider,
		SuggestedModel:    d2.SuggestedModel,
		MaxTurns:          d2.MaxTurns,
		TemplateName:      d2.TemplateName,
		TemplateVars:      map[string]string{},
		AgentGuidance:     map[string]interface{}{},
	}
	if err := json.Unmarshal([]byte(d2.AcceptanceCriteria), &s.AcceptanceCriteria); err != nil {
		return DraftSnapshot{}, fmt.Errorf("ac json: %w", err)
	}
	if err := json.Unmarshal([]byte(d2.Attachments), &s.Attachments); err != nil {
		return DraftSnapshot{}, fmt.Errorf("attachments json: %w", err)
	}
	if d2.TemplateVars != "" {
		_ = json.Unmarshal([]byte(d2.TemplateVars), &s.TemplateVars)
	}
	if d2.AgentGuidance != "" {
		_ = json.Unmarshal([]byte(d2.AgentGuidance), &s.AgentGuidance)
	}
	return s, nil
}
