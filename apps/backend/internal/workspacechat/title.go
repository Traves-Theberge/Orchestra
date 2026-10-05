package workspacechat

import (
	"context"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type RenameRequest struct {
	Title         string  `json:"title"`
	ExpectedTitle *string `json:"expected_title"`
}

// Rename changes app metadata only. The SQL compare-and-swap guards concurrent editors.
func (s *Service) Rename(ctx context.Context, pid, id string, req RenameRequest) (Session, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" || !utf8.ValidString(title) || utf8.RuneCountInString(title) > 200 || req.ExpectedTitle == nil {
		return Session{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v, err := scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE project_id=? AND id=?`, pid, id))
	if err != nil {
		return Session{}, err
	}
	if err = s.validateSessionScope(ctx, &v); err != nil {
		return Session{}, err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE workspace_chat_sessions SET title=?,updated_at=? WHERE project_id=? AND id=? AND title=?`, title, stamp(), pid, id, *req.ExpectedTitle)
	if err != nil {
		return Session{}, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return Session{}, err
	}
	if changed != 1 {
		return Session{}, ErrTitleConflict
	}
	v, err = scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE project_id=? AND id=?`, pid, id))
	if err == nil {
		err = s.validateSessionScope(ctx, &v)
	}
	if err == nil {
		err = s.decorate(ctx, &v)
	}
	return v, err
}

func (s *Service) defaultTitle(ctx context.Context, pid, workspaceID string) string {
	if pid == OrchestratorScope {
		return "New conversation"
	}
	root, err := s.registeredRoot(ctx, pid)
	if err == nil {
		row, err := workspace.ResolveGitWorktree(ctx, pid, root, workspaceID, s.roots)
		if err == nil {
			if strings.TrimSpace(row.Branch) != "" {
				return row.Branch
			}
			return filepath.Base(row.Path)
		}
	}
	return "New conversation"
}
