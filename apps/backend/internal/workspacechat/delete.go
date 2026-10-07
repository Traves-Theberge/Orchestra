package workspacechat

import (
	"context"
	"fmt"
	"strings"
)

// Tables keyed by message id, then by session id. Delete removes every row a
// conversation owns; it never touches workspace files.
var (
	chatMessageTables = []string{"workspace_chat_message_providers", "workspace_chat_message_agents", "workspace_chat_submissions", "workspace_chat_submission_efforts", "workspace_chat_submission_inputs", "workspace_chat_submission_agents"}
	chatSessionTables = []string{"workspace_chat_events", "workspace_chat_requests", "workspace_chat_native", "workspace_chat_native_agents", "workspace_chat_modes", "workspace_chat_efforts", "workspace_chat_agent_selection", "workspace_chat_creation_options", "workspace_chat_account_bindings", "workspace_chat_workspaces", "workspace_chat_lifecycle", "workspace_chat_handoffs"}
)

// Delete permanently removes an idle conversation and its history.
func (s *Service) Delete(ctx context.Context, pid, id string) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return fmt.Errorf("chat service shutting down")
	}
	sess, err := scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE project_id=? AND id=?`, pid, id))
	if err != nil {
		s.mu.Unlock()
		return err
	}
	if _, active := s.active[id]; active || sess.Status == "running" || sess.Status == "stopping" {
		s.mu.Unlock()
		return ErrBusy
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	defer tx.Rollback()
	for _, table := range chatMessageTables {
		if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE message_id IN (SELECT id FROM workspace_chat_messages WHERE session_id=?)`, id); err != nil && !missingTable(err) {
			s.mu.Unlock()
			return err
		}
	}
	for _, table := range chatSessionTables {
		if _, err = tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE session_id=?`, id); err != nil && !missingTable(err) {
			s.mu.Unlock()
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM workspace_chat_messages WHERE session_id=?`, id); err != nil {
		s.mu.Unlock()
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM workspace_chat_sessions WHERE project_id=? AND id=?`, pid, id); err != nil {
		s.mu.Unlock()
		return err
	}
	if err = tx.Commit(); err != nil {
		s.mu.Unlock()
		return err
	}
	native := s.native[id]
	delete(s.native, id)
	delete(s.nativePrefixes, id)
	s.mu.Unlock()
	if native != nil {
		closeNative(native)
	}
	return nil
}

// Optional tables are created lazily by their features; absence is not an error.
func missingTable(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no such table")
}
