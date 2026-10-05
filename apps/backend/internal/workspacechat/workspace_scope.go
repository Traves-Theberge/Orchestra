package workspacechat

import (
	"context"
	"database/sql"
	"errors"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type workspaceScopeKey struct{}

// WithWorkspaceID selects an observed worktree, not an arbitrary filesystem path.
func WithWorkspaceID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, workspaceScopeKey{}, id)
}

func selectedWorkspaceID(ctx context.Context) string {
	id, _ := ctx.Value(workspaceScopeKey{}).(string)
	return id
}

func (s *Service) scope(ctx context.Context, pid string) (string, string, bool, error) {
	root, err := s.registeredRoot(ctx, pid)
	if err != nil {
		return "", "", false, err
	}
	id := selectedWorkspaceID(ctx)
	if pid == OrchestratorScope {
		if id != "" {
			return "", "", false, ErrInvalid
		}
		return "", root, true, nil
	}
	if id == "" {
		return workspace.IDForGitWorktree(pid, root), root, true, nil
	}
	row, err := workspace.ResolveGitWorktree(ctx, pid, root, id, s.roots)
	if err != nil {
		return "", "", false, ErrForbidden
	}
	return row.ID, row.Path, row.Primary, nil
}

func (s *Service) root(ctx context.Context, pid string) (string, error) {
	_, root, _, err := s.scope(ctx, pid)
	return root, err
}

func (s *Service) bindScope(ctx context.Context, sess *Session) error {
	err := s.db.QueryRowContext(ctx, `SELECT workspace_id,cwd FROM workspace_chat_workspaces WHERE session_id=?`, sess.ID).Scan(&sess.WorkspaceID, &sess.WorkspacePath)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}

func (s *Service) validateSessionScope(ctx context.Context, sess *Session) error {
	id, root, primary, err := s.scope(ctx, sess.ProjectID)
	if err != nil {
		return err
	}
	if err = s.bindScope(ctx, sess); err != nil {
		return err
	}
	if sess.WorkspaceID == "" && sess.WorkspacePath == "" {
		if !primary {
			return ErrNotFound
		}
		// Legacy conversations belong only to the registered root checkout.
		sess.WorkspaceID, sess.WorkspacePath = id, root
		return nil
	}
	if sess.WorkspaceID != id {
		return ErrNotFound
	}
	if sess.WorkspacePath != root {
		return ErrForbidden
	}
	return nil
}
