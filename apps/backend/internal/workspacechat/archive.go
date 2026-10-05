package workspacechat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
)

// ArchiveRequest is an optimistic, checkout-scoped lifecycle mutation.
type ArchiveRequest struct {
	WorkspaceID     string `json:"workspace_id"`
	CWD             string `json:"cwd"`
	ExpectedStatus  string `json:"expected_status"`
	ExpectedVersion int64  `json:"expected_version"`
}

type lifecycleRecord struct {
	archivedAt string
	version    int64
}

func readLifecycle(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, sessionID string) (lifecycleRecord, error) {
	var out lifecycleRecord
	err := q.QueryRowContext(ctx, `SELECT archived_at,version FROM workspace_chat_lifecycle WHERE session_id=?`, sessionID).Scan(&out.archivedAt, &out.version)
	if errors.Is(err, sql.ErrNoRows) {
		return lifecycleRecord{}, nil
	}
	return out, err
}

func decorateLifecycle(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, session *Session) error {
	lifecycle, err := readLifecycle(ctx, q, session.ID)
	if err != nil {
		return err
	}
	session.ArchivedAt = lifecycle.archivedAt
	session.Archived = lifecycle.archivedAt != ""
	session.LifecycleVersion = lifecycle.version
	return nil
}

// rejectPendingRemoval must be called inside the same write transaction as a
// workspace-chat mutation. A missing receipt path fails closed for matching
// project/workspace identities; path comparison is exact and canonical.
func rejectPendingRemoval(ctx context.Context, tx *sql.Tx, projectID, workspaceID, cwd string) error {
	rows, err := tx.QueryContext(ctx, `SELECT receipt FROM worktree_removal_requests WHERE project_id=? AND workspace_id=? AND status IN ('pending','unknown')`, projectID, workspaceID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		if err = rows.Scan(&raw); err != nil {
			return err
		}
		var receipt struct {
			Path string `json:"path"`
		}
		if json.Unmarshal([]byte(raw), &receipt) != nil || receipt.Path == "" {
			return ErrBusy
		}
		if receipt.Path == cwd {
			return ErrBusy
		}
	}
	return rows.Err()
}

func (s *Service) Archive(ctx context.Context, projectID, sessionID string, req ArchiveRequest) (Session, error) {
	return s.setArchived(ctx, projectID, sessionID, req, true)
}

func (s *Service) Unarchive(ctx context.Context, projectID, sessionID string, req ArchiveRequest) (Session, error) {
	return s.setArchived(ctx, projectID, sessionID, req, false)
}

func (s *Service) setArchived(ctx context.Context, projectID, sessionID string, req ArchiveRequest, archive bool) (Session, error) {
	if projectID == OrchestratorScope || sessionID == "" || req.WorkspaceID == "" || req.CWD == "" || !filepath.IsAbs(req.CWD) || (selectedWorkspaceID(ctx) != "" && selectedWorkspaceID(ctx) != req.WorkspaceID) || req.ExpectedStatus == "" || req.ExpectedVersion < 0 {
		return Session{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Root workspaces also exist for non-Git projects. Resolve that default
	// first; only non-root IDs need membership in the live Git worktree registry.
	id, cwd, primary, err := s.scope(WithWorkspaceID(ctx, ""), projectID)
	if err != nil {
		return Session{}, err
	}
	if id != req.WorkspaceID {
		id, cwd, primary, err = s.scope(WithWorkspaceID(ctx, req.WorkspaceID), projectID)
		if err != nil {
			return Session{}, err
		}
	}
	if id != req.WorkspaceID || cwd != req.CWD {
		return Session{}, ErrForbidden
	}
	sess, err := scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE project_id=? AND id=?`, projectID, sessionID))
	if err != nil {
		return Session{}, err
	}
	if err = s.bindScope(ctx, &sess); err != nil {
		return Session{}, err
	}
	legacyRootBinding := sess.WorkspaceID == "" && sess.WorkspacePath == "" && primary
	if legacyRootBinding {
		// Older root conversations predate workspace_chat_workspaces. Match the
		// legacy fallback used by validateSessionScope, but only for this exact
		// registered primary root. Persist the identity in the archive transaction
		// so the database-only archive catalog can surface it afterwards.
		sess.WorkspaceID, sess.WorkspacePath = id, cwd
	}
	if sess.WorkspaceID != id || sess.WorkspacePath != cwd {
		return Session{}, ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_chat_lifecycle(session_id) VALUES(?)`, sessionID); err != nil {
		return Session{}, err
	}
	if err = rejectPendingRemoval(ctx, tx, projectID, id, cwd); err != nil {
		return Session{}, err
	}
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM workspace_chat_sessions WHERE project_id=? AND id=?`, projectID, sessionID).Scan(&status); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Session{}, ErrNotFound
		}
		return Session{}, err
	}
	lifecycle, err := readLifecycle(ctx, tx, sessionID)
	if err != nil {
		return Session{}, err
	}
	if status != req.ExpectedStatus || lifecycle.version != req.ExpectedVersion || (lifecycle.archivedAt != "") == archive {
		return Session{}, ErrConflict
	}
	if status == "running" || status == "stopping" || status == "unknown" {
		return Session{}, ErrBusy
	}
	var unsettled int
	if err = tx.QueryRowContext(ctx, `SELECT
		(SELECT COUNT(*) FROM workspace_chat_messages WHERE session_id=? AND role='user' AND status IN ('accepted','unknown')) +
		(SELECT COUNT(*) FROM workspace_chat_requests WHERE session_id=? AND status IN ('pending','sending','unknown'))`, sessionID, sessionID).Scan(&unsettled); err != nil {
		return Session{}, err
	}
	if unsettled > 0 {
		return Session{}, ErrBusy
	}
	if legacyRootBinding {
		if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_workspaces(session_id,workspace_id,cwd) VALUES(?,?,?) ON CONFLICT(session_id) DO NOTHING`, sessionID, id, cwd); err != nil {
			return Session{}, err
		}
		var storedID, storedCWD string
		if err = tx.QueryRowContext(ctx, `SELECT workspace_id,cwd FROM workspace_chat_workspaces WHERE session_id=?`, sessionID).Scan(&storedID, &storedCWD); err != nil {
			return Session{}, err
		}
		if storedID != id || storedCWD != cwd {
			return Session{}, ErrNotFound
		}
	}
	now := stamp()
	archivedAt := ""
	if archive {
		archivedAt = now
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_lifecycle(session_id,archived_at,version) VALUES(?,?,?) ON CONFLICT(session_id) DO UPDATE SET archived_at=excluded.archived_at,version=excluded.version`, sessionID, archivedAt, lifecycle.version+1); err != nil {
		return Session{}, err
	}
	if err = tx.Commit(); err != nil {
		return Session{}, err
	}
	sess.Archived = archive
	sess.ArchivedAt = archivedAt
	sess.LifecycleVersion = lifecycle.version + 1
	if err = s.decorate(ctx, &sess); err != nil {
		return Session{}, err
	}
	return sess, nil
}

// ArchivedList is a database-only history read, so it continues to work after
// a linked worktree directory has been removed. Identity is matched exactly.
func (s *Service) ArchivedList(ctx context.Context, projectID, workspaceID, cwd string) ([]Session, error) {
	if projectID == "" || projectID == OrchestratorScope || workspaceID == "" || cwd == "" || !filepath.IsAbs(cwd) {
		return nil, ErrInvalid
	}
	if _, err := s.db.GetProjectByID(ctx, projectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+sessionFields+`,w.workspace_id,w.cwd,l.archived_at,l.version
		FROM workspace_chat_sessions s JOIN workspace_chat_workspaces w ON w.session_id=s.id
		JOIN workspace_chat_lifecycle l ON l.session_id=s.id
		WHERE s.project_id=? AND w.workspace_id=? AND w.cwd=? AND l.archived_at<>'' ORDER BY l.archived_at DESC`, projectID, workspaceID, cwd)
	if err != nil {
		return nil, err
	}
	result := []Session{}
	for rows.Next() {
		var sess Session
		if err = rows.Scan(&sess.ID, &sess.ProjectID, &sess.Provider, &sess.Title, &sess.Status, &sess.CreatedAt, &sess.UpdatedAt, &sess.Error, &sess.WorkspaceID, &sess.WorkspacePath, &sess.ArchivedAt, &sess.LifecycleVersion); err != nil {
			return nil, err
		}
		sess.Archived = true
		result = append(result, sess)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range result {
		if err = s.decorate(ctx, &result[i]); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// ArchivedCatalog returns only retained metadata for all archived workspaces
// in a project. It never inspects their filesystem paths.
func (s *Service) ArchivedCatalog(ctx context.Context, projectID string) ([]Session, error) {
	if projectID == "" || projectID == OrchestratorScope {
		return nil, ErrInvalid
	}
	if _, err := s.db.GetProjectByID(ctx, projectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+sessionFields+`,w.workspace_id,w.cwd,l.archived_at,l.version
		FROM workspace_chat_sessions s JOIN workspace_chat_workspaces w ON w.session_id=s.id
		JOIN workspace_chat_lifecycle l ON l.session_id=s.id
		WHERE s.project_id=? AND l.archived_at<>'' ORDER BY l.archived_at DESC`, projectID)
	if err != nil {
		return nil, err
	}
	result := []Session{}
	for rows.Next() {
		var sess Session
		if err = rows.Scan(&sess.ID, &sess.ProjectID, &sess.Provider, &sess.Title, &sess.Status, &sess.CreatedAt, &sess.UpdatedAt, &sess.Error, &sess.WorkspaceID, &sess.WorkspacePath, &sess.ArchivedAt, &sess.LifecycleVersion); err != nil {
			return nil, err
		}
		sess.Archived = true
		result = append(result, sess)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range result {
		if err = s.decorate(ctx, &result[i]); err != nil {
			return nil, err
		}
	}
	return result, nil
}

// ArchivedDetailAfter reads retained transcript/provider observations without
// resolving the checkout or starting a provider process.
func (s *Service) ArchivedDetailAfter(ctx context.Context, projectID, sessionID, workspaceID, cwd string, after int64) (Detail, error) {
	if projectID == "" || projectID == OrchestratorScope || sessionID == "" || workspaceID == "" || cwd == "" || !filepath.IsAbs(cwd) || after < 0 {
		return Detail{}, ErrInvalid
	}
	if _, err := s.db.GetProjectByID(ctx, projectID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Detail{}, ErrNotFound
		}
		return Detail{}, err
	}
	var sess Session
	err := s.db.QueryRowContext(ctx, `SELECT `+sessionFields+`,w.workspace_id,w.cwd,l.archived_at,l.version
		FROM workspace_chat_sessions s JOIN workspace_chat_workspaces w ON w.session_id=s.id
		JOIN workspace_chat_lifecycle l ON l.session_id=s.id
		WHERE s.project_id=? AND s.id=? AND w.workspace_id=? AND w.cwd=? AND l.archived_at<>''`, projectID, sessionID, workspaceID, cwd).Scan(
		&sess.ID, &sess.ProjectID, &sess.Provider, &sess.Title, &sess.Status, &sess.CreatedAt, &sess.UpdatedAt, &sess.Error,
		&sess.WorkspaceID, &sess.WorkspacePath, &sess.ArchivedAt, &sess.LifecycleVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return Detail{}, ErrNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	sess.Archived = true
	rows, err := s.db.QueryContext(ctx, `SELECT id,session_id,role,text,status,client_message_id,created_at FROM workspace_chat_messages WHERE session_id=? ORDER BY ordinal`, sessionID)
	if err != nil {
		return Detail{}, err
	}
	detail := Detail{Session: sess, Messages: []Message{}}
	for rows.Next() {
		var message Message
		if err = rows.Scan(&message.ID, &message.SessionID, &message.Role, &message.Text, &message.Status, &message.ClientMessageID, &message.CreatedAt); err != nil {
			rows.Close()
			return Detail{}, err
		}
		detail.Messages = append(detail.Messages, message)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Detail{}, err
	}
	if err = s.decorate(ctx, &detail.Session); err != nil {
		return Detail{}, err
	}
	if err = s.loadNative(ctx, &detail, after); err != nil {
		return Detail{}, err
	}
	return detail, nil
}
