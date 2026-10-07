package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

type SwitchProviderRequest struct {
	Provider         string `json:"provider"`
	ExpectedProvider string `json:"expected_provider"`
}

// Each harness owns its own native thread, so a switch cannot resume the
// previous provider's session. Orchestra's message log is the provider-neutral
// source of truth: the first turn on the new harness replays it as context,
// then later turns resume the new harness natively.
func migrateHarnessSwitch(d *db.DB) error {
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_handoffs(session_id TEXT PRIMARY KEY, from_provider TEXT NOT NULL, created_at TEXT NOT NULL);
	 CREATE TABLE IF NOT EXISTS workspace_chat_message_providers(message_id TEXT PRIMARY KEY, provider TEXT NOT NULL);`)
	return err
}

// SwitchProvider moves an idle conversation to another harness without
// discarding its history. The compare-and-swap on the expected provider
// guards concurrent pickers.
func (s *Service) SwitchProvider(ctx context.Context, pid, id string, req SwitchProviderRequest) (Session, error) {
	p := agents.NormalizeProvider(req.Provider)
	expected := agents.NormalizeProvider(req.ExpectedProvider)
	if strings.TrimSpace(req.Provider) == "" || strings.TrimSpace(req.ExpectedProvider) == "" {
		return Session{}, ErrInvalid
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return Session{}, fmt.Errorf("chat service shutting down")
	}
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		s.mu.Unlock()
		return Session{}, err
	}
	if d.Session.Archived {
		s.mu.Unlock()
		return Session{}, ErrNotFound
	}
	if d.Session.Provider != string(expected) {
		s.mu.Unlock()
		return Session{}, ErrConflict
	}
	if d.Session.Provider == string(p) {
		s.mu.Unlock()
		return d.Session, nil
	}
	if _, ok := s.active[id]; ok || d.Session.Status == "running" || d.Session.Status == "stopping" {
		s.mu.Unlock()
		return Session{}, ErrBusy
	}
	if !s.registry.HasProvider(p) {
		s.mu.Unlock()
		return Session{}, ErrUnsupported
	}
	if err = s.registry.ValidateTurnOptions(p, agents.TurnRequest{RuntimeTarget: agents.RuntimeLocal}); err != nil {
		s.mu.Unlock()
		return Session{}, fmt.Errorf("%w: %s", ErrUnsupported, err)
	}
	account := "system_default"
	if selector, ok := s.registry.(interface{ ActiveAccount(agents.Provider) string }); ok {
		if selected := selector.ActiveAccount(p); selected != "" {
			account = selected
		}
	}
	mode := Mode
	if s.supportsNative(p) {
		mode = "native_session"
	}
	now := stamp()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.mu.Unlock()
		return Session{}, err
	}
	defer tx.Rollback()
	steps := []struct {
		query string
		args  []any
	}{
		{`UPDATE workspace_chat_sessions SET provider=?,status='idle',error='',updated_at=? WHERE project_id=? AND id=? AND provider=?`, []any{string(p), now, pid, id, string(expected)}},
		{`INSERT INTO workspace_chat_account_bindings(session_id,account_id) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET account_id=excluded.account_id`, []any{id, account}},
		{`INSERT INTO workspace_chat_modes(session_id,mode) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET mode=excluded.mode`, []any{id, mode}},
		// Model, effort, and agent identities are harness-specific; the new
		// harness starts from its own defaults on a fresh native thread.
		{`INSERT INTO workspace_chat_native(session_id) VALUES(?) ON CONFLICT(session_id) DO UPDATE SET thread_id='',requested_model='',effective_model='',approval_policy='',sandbox_mode='',cumulative_turn_count=NULL`, []any{id}},
		{`INSERT INTO workspace_chat_efforts(session_id) VALUES(?) ON CONFLICT(session_id) DO UPDATE SET requested='',observed=''`, []any{id}},
		{`INSERT INTO workspace_chat_agent_selection(session_id) VALUES(?) ON CONFLICT(session_id) DO UPDATE SET requested_agent_id='',scope='',content_hash='',format='',effective_agent_id='',observation=''`, []any{id}},
		{`UPDATE workspace_chat_requests SET status='stale' WHERE session_id=? AND status='pending'`, []any{id}},
	}
	for i, step := range steps {
		result, e := tx.ExecContext(ctx, step.query, step.args...)
		if e != nil {
			s.mu.Unlock()
			return Session{}, e
		}
		if i == 0 {
			if changed, e := result.RowsAffected(); e != nil || changed != 1 {
				s.mu.Unlock()
				return Session{}, ErrConflict
			}
		}
	}
	// Tag existing history with the harness that produced it before the
	// session-level provider changes.
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_chat_message_providers(message_id,provider) SELECT id,? FROM workspace_chat_messages WHERE session_id=?`, d.Session.Provider, id); err != nil {
		s.mu.Unlock()
		return Session{}, err
	}
	if len(d.Messages) > 0 {
		// Keep the earliest unreplayed origin if the user switches again
		// before the new harness completes a turn.
		if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_handoffs(session_id,from_provider,created_at) VALUES(?,?,?) ON CONFLICT(session_id) DO NOTHING`, id, d.Session.Provider, now); err != nil {
			s.mu.Unlock()
			return Session{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		s.mu.Unlock()
		return Session{}, err
	}
	native := s.native[id]
	delete(s.native, id)
	delete(s.nativePrefixes, id)
	s.mu.Unlock()
	if native != nil {
		closeNative(native)
	}
	v, err := s.Detail(ctx, pid, id)
	return v.Session, err
}

func (s *Service) handoffPending(ctx context.Context, id string) (string, bool, error) {
	var from string
	err := s.db.QueryRowContext(ctx, `SELECT from_provider FROM workspace_chat_handoffs WHERE session_id=?`, id).Scan(&from)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return from, err == nil, err
}

// handoffTranscript replays the provider-neutral log into a new harness's
// first native turn.
func handoffTranscript(messages []Message, from, to, prompt string, budget int) string {
	header := fmt.Sprintf("This conversation was continued from the %s harness and is now running on %s. Your native session starts here; the earlier Orchestra conversation follows as context. Work only in the selected project.\n", from, to)
	return replayTranscript(header, messages, prompt, budget)
}

// Inline image attachments are base64 data URLs; replaying them would spend the
// whole budget on bytes a text prompt cannot use.
var inlineImage = regexp.MustCompile(`!\[([^\]]*)\]\(data:image/[^)]+\)`)

// replayTranscript fills the budget newest-first so a long conversation
// degrades by dropping its oldest turns instead of refusing the message.
func replayTranscript(header string, messages []Message, prompt string, budget int) string {
	tail := fmt.Sprintf("\n[user]\n%s", prompt)
	const omittedNote = "\n[earlier messages omitted to fit the context budget]\n"
	remaining := budget - len(header) - len(tail) - len(omittedNote)
	var blocks []string
	omitted := false
	for i := len(messages) - 1; i >= 0; i-- {
		m := messages[i]
		if m.Status != "completed" {
			continue
		}
		block := fmt.Sprintf("\n[%s]\n%s\n", m.Role, inlineImage.ReplaceAllString(m.Text, "[image: $1]"))
		if len(block) > remaining {
			omitted = true
			break
		}
		remaining -= len(block)
		blocks = append(blocks, block)
	}
	var b strings.Builder
	b.WriteString(header)
	if omitted {
		b.WriteString(omittedNote)
	}
	for i := len(blocks) - 1; i >= 0; i-- {
		b.WriteString(blocks[i])
	}
	b.WriteString(tail)
	return b.String()
}
