package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"time"
)

// UpsertProject takes the local workspace context and creates or updates a Project record
// Returns the canonical Project ID.
func (db *DB) UpsertProject(ctx context.Context, rootPath string, remoteURL string) (string, error) {
	// Canonicalize path to prevent duplicates
	cleanPath := filepath.Clean(rootPath)
	if evalPath, err := filepath.EvalSymlinks(cleanPath); err == nil {
		cleanPath = evalPath
	}

	// Generate ID based on canonical path
	hash := sha256.Sum256([]byte(cleanPath))
	id := hex.EncodeToString(hash[:16])

	// Extract name
	name := filepath.Base(cleanPath)
	if name == "." || name == "/" {
		name = "Workspace"
	}

	query := `
		INSERT INTO projects (id, name, root_path, remote_url, github_owner, github_repo, github_token)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = CASE WHEN excluded.name != '' AND projects.name = 'Workspace' THEN excluded.name ELSE projects.name END,
			remote_url = CASE WHEN excluded.remote_url != '' THEN excluded.remote_url ELSE projects.remote_url END,
			github_owner = CASE WHEN excluded.github_owner != '' THEN excluded.github_owner ELSE projects.github_owner END,
			github_repo = CASE WHEN excluded.github_repo != '' THEN excluded.github_repo ELSE projects.github_repo END,
			github_token = CASE WHEN excluded.github_token != '' THEN excluded.github_token ELSE projects.github_token END
	`
	_, err := db.ExecContext(ctx, query, id, name, cleanPath, remoteURL, "", "", "")
	if err != nil {
		return "", fmt.Errorf("upsert project: %w", err)
	}

	return id, nil
}

// RecordSession initializes a telemetry session and ties it to a project and issue.
func (db *DB) RecordSession(ctx context.Context, sessionID, projectID, issueID, sessionUUID, provider, model, branch string) error {
	var prjID *string
	if projectID != "" {
		prjID = &projectID
	}
	var issID *string
	if issueID != "" {
		issID = &issueID
	}

	query := `
		INSERT INTO sessions (id, project_id, issue_id, session_uuid, provider, model, branch)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			project_id = CASE WHEN sessions.project_id IS NULL OR sessions.project_id = '' THEN excluded.project_id ELSE sessions.project_id END,
			issue_id = CASE WHEN sessions.issue_id IS NULL OR sessions.issue_id = '' THEN excluded.issue_id ELSE sessions.issue_id END,
			model = CASE WHEN excluded.model != '' AND (sessions.model IS NULL OR sessions.model = '') THEN excluded.model ELSE sessions.model END
	`
	_, err := db.ExecContext(ctx, query, sessionID, prjID, issID, sessionUUID, provider, model, branch)
	return err
}

// UpdateSessionModel updates the model for a session if it was previously unknown
func (db *DB) UpdateSessionModel(ctx context.Context, sessionID, model string) error {
	if model == "" {
		return nil
	}
	_, err := db.ExecContext(ctx, "UPDATE sessions SET model = ? WHERE id = ? AND (model IS NULL OR model = '')", model, sessionID)
	return err
}

// UpdateSessionProject updates the project association for a session if it was previously unknown
func (db *DB) UpdateSessionProject(ctx context.Context, sessionID, projectID string) error {
	if projectID == "" {
		return nil
	}
	_, err := db.ExecContext(ctx, "UPDATE sessions SET project_id = ? WHERE id = ? AND (project_id IS NULL OR project_id = '')", projectID, sessionID)
	return err
}

// RecordEvent records an atomic agent progression event
func (db *DB) RecordEvent(ctx context.Context, eventID, sessionID, kind, message string, rawPayload []byte, inputTokens, outputTokens int, timestampStr string) error {
	// Local-First Optimization: Don't duplicate heavy tool results or logs into the DB.
	// We keep 'message' and 'tool_use' (parameters) but drop the large output bodies.
	if kind == "tool_result" || kind == "stdout" || kind == "stderr" || kind == "file_content" {
		rawPayload = nil
	}

	// Safety check: Prevent infinite loop bloat by capping events per session
	var count int
	_ = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM events WHERE session_id = ?", sessionID).Scan(&count)
	if count > 2000 {
		return nil // Silently drop to protect system integrity
	}

	query := `
		INSERT INTO events (id, session_id, kind, message, raw_payload, input_tokens, output_tokens, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING
	`

	// Security/Stability: Cap any remaining raw payload size at 512KB
	const maxPayloadSize = 512 * 1024
	var raw interface{}
	if len(rawPayload) > 0 {
		if len(rawPayload) > maxPayloadSize {
			truncated := append(rawPayload[:maxPayloadSize], []byte("\n... [TRUNCATED] ...")...)
			raw = string(truncated)
		} else {
			raw = string(rawPayload)
		}
	}

	var tsTime interface{}
	if timestampStr != "" {
		tsTime = timestampStr
	}

	_, err := db.ExecContext(ctx, query, eventID, sessionID, kind, message, raw, inputTokens, outputTokens, tsTime)
	return err
}

// PruneEvents removes events older than the specified duration
func (db *DB) PruneEvents(ctx context.Context, maxAgeDays int) (int64, error) {
	query := `DELETE FROM events WHERE timestamp < date('now', '-' || ? || ' days')`
	res, err := db.ExecContext(ctx, query, maxAgeDays)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// GetUnifiedHistory returns a combined timeline of issue metadata changes and agent events
func (db *DB) GetUnifiedHistory(ctx context.Context, issueID string) ([]map[string]any, error) {
	query := `
		SELECT 
			'metadata' as source,
			id,
			user_id as provider,
			action as kind,
			COALESCE(old_value || ' -> ' || new_value, action) as message,
			0 as input_tokens,
			0 as output_tokens,
			timestamp
		FROM issue_history
		WHERE issue_id = ?
		
		UNION ALL
		
		SELECT
			'agent' as source,
			e.id,
			s.provider,
			e.kind,
			SUBSTR(e.message, 1, 4000) as message,
			e.input_tokens,
			e.output_tokens,
			e.timestamp
		FROM events e
		JOIN sessions s ON e.session_id = s.id
		WHERE s.issue_id = ?
		AND e.kind NOT IN ('pty', 'stderr', 'system', 'rate_limit_event', 'item.started')
		AND (e.message IS NOT NULL AND e.message != '' AND LENGTH(e.message) > 5)

		ORDER BY timestamp ASC
		LIMIT 500
	`

	rows, err := db.QueryContext(ctx, query, issueID, issueID)
	if err != nil {
		return nil, fmt.Errorf("query unified history: %w", err)
	}
	defer rows.Close()

	var history []map[string]any
	for rows.Next() {
		var source, id, provider, kind, message, timestamp string
		var inputTokens, outputTokens int
		if err := rows.Scan(&source, &id, &provider, &kind, &message, &inputTokens, &outputTokens, &timestamp); err != nil {
			return nil, fmt.Errorf("scan unified history row: %w", err)
		}

		history = append(history, map[string]any{
			"source":        source,
			"id":            id,
			"provider":      provider,
			"kind":          kind,
			"message":       message,
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
			"timestamp":     timestamp,
		})
	}
	return history, nil
}

// Project represents a registered codebase with optional GitHub integration credentials.
//
// GitHubToken is intentionally tagged with `json:"-"` so the raw secret never
// ships to API clients. MarshalJSON below emits a fixed sentinel ("<set>" /
// "") so callers can still tell whether the project is GitHub-connected
// without seeing the token value.
type Project struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	RootPath        string `json:"root_path"`
	RemoteURL       string `json:"remote_url"`
	GitHubOwner     string `json:"github_owner"`
	GitHubRepo      string `json:"github_repo"`
	GitHubToken     string `json:"-"`
	TrackerConfigID string `json:"tracker_config_id"`
	PathExists      bool   `json:"path_exists"`
}

// GitHubTokenRedactedSentinel is what API clients see in place of a configured
// GitHub token. Treat as opaque and truthy ("connected") only; never as the
// real secret.
const GitHubTokenRedactedSentinel = "<set>"

// MarshalJSON serializes Project to the wire format expected by API clients,
// replacing GitHubToken with a redacted sentinel.
func (p Project) MarshalJSON() ([]byte, error) {
	type wire struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		RootPath        string `json:"root_path"`
		RemoteURL       string `json:"remote_url"`
		GitHubOwner     string `json:"github_owner"`
		GitHubRepo      string `json:"github_repo"`
		GitHubToken     string `json:"github_token"`
		TrackerConfigID string `json:"tracker_config_id"`
		PathExists      bool   `json:"path_exists"`
	}
	w := wire{
		ID: p.ID, Name: p.Name, RootPath: p.RootPath, RemoteURL: p.RemoteURL,
		GitHubOwner: p.GitHubOwner, GitHubRepo: p.GitHubRepo,
		TrackerConfigID: p.TrackerConfigID, PathExists: p.PathExists,
	}
	if p.GitHubToken != "" {
		w.GitHubToken = GitHubTokenRedactedSentinel
	}
	return json.Marshal(w)
}

// ProjectStats holds aggregate telemetry metrics for a project.
type ProjectStats struct {
	TotalSessions int64  `json:"total_sessions"`
	TotalInput    int64  `json:"total_input"`
	TotalOutput   int64  `json:"total_output"`
	LastActive    string `json:"last_active"`
}

// GetProjects returns all registered projects, ordered by name, with decrypted GitHub tokens.
func (db *DB) GetProjects(ctx context.Context) ([]Project, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, name, root_path, remote_url,
		COALESCE(github_owner, ''), COALESCE(github_repo, ''), COALESCE(github_token, ''),
		COALESCE(tracker_config_id, '')
		FROM projects ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.RootPath, &p.RemoteURL,
			&p.GitHubOwner, &p.GitHubRepo, &p.GitHubToken, &p.TrackerConfigID); err != nil {
			return nil, err
		}
		if p.GitHubToken != "" {
			if dec, err := DecryptToken(p.GitHubToken); err == nil {
				p.GitHubToken = dec
			} else {
				log.Printf("WARN: failed to decrypt github token for project %s: %v", p.ID, err)
				p.GitHubToken = ""
			}
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

// GetProjectStats returns aggregate session count, token usage, and last-active
// timestamp for the given project.
func (db *DB) GetProjectStats(ctx context.Context, projectID string) (ProjectStats, error) {
	query := `
		SELECT 
			COUNT(DISTINCT s.id),
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0),
			MAX(s.created_at)
		FROM sessions s
		LEFT JOIN events e ON s.id = e.session_id
		WHERE s.project_id = ?
	`
	var stats ProjectStats
	var lastActive sql.NullString
	err := db.QueryRowContext(ctx, query, projectID).Scan(&stats.TotalSessions, &stats.TotalInput, &stats.TotalOutput, &lastActive)
	if err != nil {
		return stats, err
	}
	if lastActive.Valid {
		stats.LastActive = lastActive.String
	}
	return stats, nil
}

// DeleteProject removes a project and all its associated data (sessions, events,
// runs, issues, issue_history) in a single transaction with cascading deletes.
func (db *DB) DeleteProject(ctx context.Context, projectID string) error {
	if projectID == "" {
		return fmt.Errorf("project_id is required")
	}

	// Defer FK checks to commit time so intermediate states don't trigger constraint errors.
	if _, err := db.ExecContext(ctx, "PRAGMA defer_foreign_keys = ON"); err != nil {
		return fmt.Errorf("set defer_foreign_keys: %w", err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Delete events for sessions owned by this project
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM events
		WHERE session_id IN (
			SELECT id FROM sessions WHERE project_id = ?
		)
	`, projectID); err != nil {
		return fmt.Errorf("delete project events: %w", err)
	}

	// 2. Delete runs linked via sessions owned by this project
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM runs
		WHERE session_id IN (
			SELECT id FROM sessions WHERE project_id = ?
		)
	`, projectID); err != nil {
		return fmt.Errorf("delete project session runs: %w", err)
	}

	// 3. Delete sessions owned by this project
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE project_id = ?", projectID); err != nil {
		return fmt.Errorf("delete project sessions: %w", err)
	}

	// 4. Delete runs linked to issues in this project
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM runs
		WHERE issue_id IN (
			SELECT id FROM issues WHERE project_id = ?
		)
	`, projectID); err != nil {
		return fmt.Errorf("delete project issue runs: %w", err)
	}

	// 5. Delete issue history for issues in this project
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM issue_history
		WHERE issue_id IN (
			SELECT id FROM issues WHERE project_id = ?
		)
	`, projectID); err != nil {
		return fmt.Errorf("delete project issue history: %w", err)
	}

	// 6. Clear session.issue_id references to issues we're about to delete
	if _, err := tx.ExecContext(ctx, `
		UPDATE sessions SET issue_id = NULL
		WHERE issue_id IN (
			SELECT id FROM issues WHERE project_id = ?
		)
	`, projectID); err != nil {
		return fmt.Errorf("clear session issue refs: %w", err)
	}

	// 7. Delete issues in this project
	if _, err := tx.ExecContext(ctx, "DELETE FROM issues WHERE project_id = ?", projectID); err != nil {
		return fmt.Errorf("delete project issues: %w", err)
	}

	// 8. Delete the project itself
	result, err := tx.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", projectID)
	if err != nil {
		return fmt.Errorf("delete project: %w", err)
	}

	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}

	return tx.Commit()
}

// GetProjectByID retrieves a single project by its ID, with decrypted GitHub token.
func (db *DB) GetProjectByID(ctx context.Context, id string) (Project, error) {
	var p Project
	err := db.QueryRowContext(ctx, "SELECT id, name, root_path, remote_url, COALESCE(github_owner, ''), COALESCE(github_repo, ''), COALESCE(github_token, ''), COALESCE(tracker_config_id, '') FROM projects WHERE id = ?", id).
		Scan(&p.ID, &p.Name, &p.RootPath, &p.RemoteURL, &p.GitHubOwner, &p.GitHubRepo, &p.GitHubToken, &p.TrackerConfigID)
	if err == nil && p.GitHubToken != "" {
		if dec, decErr := DecryptToken(p.GitHubToken); decErr == nil {
			p.GitHubToken = dec
		} else {
			log.Printf("WARN: failed to decrypt github token for project %s: %v", p.ID, decErr)
			p.GitHubToken = ""
		}
	}
	return p, err
}

// UpdateProjectGitHubInfo sets the GitHub owner and repo for an existing project.
func (db *DB) UpdateProjectGitHubInfo(ctx context.Context, id, owner, repo string) error {
	_, err := db.ExecContext(ctx, "UPDATE projects SET github_owner = ?, github_repo = ? WHERE id = ?", owner, repo, id)
	return err
}

// UpdateProjectGitHubFull sets the GitHub owner, repo, and remote URL for an existing project.
func (db *DB) UpdateProjectGitHubFull(ctx context.Context, id, owner, repo, remoteURL string) error {
	_, err := db.ExecContext(ctx, "UPDATE projects SET github_owner = ?, github_repo = ?, remote_url = ? WHERE id = ?", owner, repo, remoteURL, id)
	return err
}

// Session represents an agent execution session linked to a project and provider.
type Session struct {
	ID          string `json:"id"`
	ProjectID   string `json:"project_id"`
	ProjectName string `json:"project_name"`
	SessionUUID string `json:"session_uuid"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	Branch      string `json:"branch"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	TotalInput  int64  `json:"total_input"`
	TotalOutput int64  `json:"total_output"`
}

// Event represents a single agent progression event stored in the database.
type Event struct {
	ID           string `json:"id"`
	SessionID    string `json:"session_id"`
	Kind         string `json:"kind"`
	Message      string `json:"message"`
	RawPayload   string `json:"raw_payload"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	Timestamp    string `json:"timestamp"`
}

// SessionDetail combines a Session with its ordered list of Events.
type SessionDetail struct {
	Session
	Events []Event `json:"events"`
}

// GetSessions returns sessions optionally filtered by project ID, with aggregated
// token usage and last-activity timestamps. An empty projectID returns all sessions.
func (db *DB) GetSessions(ctx context.Context, projectID string) ([]Session, error) {
	var rows *sql.Rows
	var err error

	query := `
		SELECT
			s.id, s.project_id, p.name, s.session_uuid, s.provider, COALESCE(s.model, ''), s.branch, s.created_at,
			COALESCE(MAX(e.timestamp), s.created_at) as updated_at,
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0)
		FROM sessions s
		LEFT JOIN projects p ON s.project_id = p.id
		LEFT JOIN events e ON s.id = e.session_id
	`

	if projectID != "" {
		query += " WHERE s.project_id = ? GROUP BY s.id ORDER BY updated_at DESC"
		rows, err = db.QueryContext(ctx, query, projectID)
	} else {
		query += " GROUP BY s.id ORDER BY updated_at DESC"
		rows, err = db.QueryContext(ctx, query)
	}

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		var prjID, prjName, branch sql.NullString
		if err := rows.Scan(&s.ID, &prjID, &prjName, &s.SessionUUID, &s.Provider, &s.Model, &branch, &s.CreatedAt, &s.UpdatedAt, &s.TotalInput, &s.TotalOutput); err != nil {
			return nil, err
		}
		if prjID.Valid {
			s.ProjectID = prjID.String
		}
		if prjName.Valid {
			s.ProjectName = prjName.String
		}
		if branch.Valid {
			s.Branch = branch.String
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// GetSessionDetail retrieves a session and all its events by session ID.
func (db *DB) GetSessionDetail(ctx context.Context, sessionID string) (*SessionDetail, error) {
	var detail SessionDetail

	sessionQuery := `
		SELECT
			s.id, s.project_id, p.name, s.session_uuid, s.provider, COALESCE(s.model, ''), s.branch, s.created_at,
			COALESCE(MAX(e.timestamp), s.created_at) as updated_at,
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0)
		FROM sessions s
		LEFT JOIN projects p ON s.project_id = p.id
		LEFT JOIN events e ON s.id = e.session_id
		WHERE s.id = ?
		GROUP BY s.id
	`
	var prjID, prjName, branch sql.NullString
	err := db.QueryRowContext(ctx, sessionQuery, sessionID).Scan(
		&detail.ID, &prjID, &prjName, &detail.SessionUUID, &detail.Provider,
		&detail.Model, &branch, &detail.CreatedAt, &detail.UpdatedAt, &detail.TotalInput, &detail.TotalOutput,
	)
	if err != nil {
		return nil, err
	}
	if prjID.Valid {
		detail.ProjectID = prjID.String
	}
	if prjName.Valid {
		detail.ProjectName = prjName.String
	}
	if branch.Valid {
		detail.Branch = branch.String
	}

	eventRows, err := db.QueryContext(ctx, `
		SELECT id, session_id, kind, message, COALESCE(raw_payload, ''), input_tokens, output_tokens, timestamp
		FROM events
		WHERE session_id = ?
		ORDER BY timestamp ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer eventRows.Close()

	for eventRows.Next() {
		var e Event
		if err := eventRows.Scan(&e.ID, &e.SessionID, &e.Kind, &e.Message, &e.RawPayload, &e.InputTokens, &e.OutputTokens, &e.Timestamp); err != nil {
			return nil, err
		}
		detail.Events = append(detail.Events, e)
	}

	return &detail, nil
}

// ProviderTokens holds per-provider input/output token breakdowns.
type ProviderTokens struct {
	Total      int64 `json:"total"`
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	CacheRead  int64 `json:"cache_read"`
	CacheWrite int64 `json:"cache_write"`
	Thinking   int64 `json:"thinking"`
}

// ProviderSessionStats holds per-provider session counts and success rates.
type ProviderSessionStats struct {
	Total       int64   `json:"total"`
	Completed   int64   `json:"completed"`
	Failed      int64   `json:"failed"`
	AvgDuration float64 `json:"avg_duration"`
}

// GlobalStats holds platform-wide aggregate metrics including total tokens,
// per-provider and per-model breakdowns, and recent sessions.
type GlobalStats struct {
	TotalTokens      int64                              `json:"total_tokens"`
	TotalInput       int64                              `json:"total_input"`
	TotalOutput      int64                              `json:"total_output"`
	TotalCacheRead   int64                              `json:"total_cache_read"`
	TotalCacheWrite  int64                              `json:"total_cache_write"`
	TotalThinking    int64                              `json:"total_thinking"`
	ProviderUsage    map[string]int64                   `json:"provider_usage"`
	ProviderTokens   map[string]ProviderTokens          `json:"provider_tokens"`
	ModelUsage       map[string]int64                   `json:"model_usage"`
	ProviderSessions map[string]ProviderSessionStats    `json:"provider_sessions"`
	RecentSessions   []Session                          `json:"recent_sessions"`
}

// StatsOption configures optional filters for GetGlobalStats.
type StatsOption func(*statsOpts)

type statsOpts struct {
	since     *time.Time
	until     *time.Time
	provider  string
	projectID string
}

// WithSince filters stats to only include data after the given time.
func WithSince(t time.Time) StatsOption {
	return func(o *statsOpts) { o.since = &t }
}

// WithUntil filters stats to only include data before the given time.
func WithUntil(t time.Time) StatsOption {
	return func(o *statsOpts) { o.until = &t }
}

// WithProvider filters stats to only include data for the given provider.
func WithProvider(p string) StatsOption {
	return func(o *statsOpts) { o.provider = p }
}

// WithProjectID filters stats to only include data for the given project.
func WithProjectID(id string) StatsOption {
	return func(o *statsOpts) { o.projectID = id }
}

// GetGlobalStats computes platform-wide token usage, per-provider and per-model
// breakdowns, and includes the most recent 50 sessions. Accepts optional
// StatsOption filters for time-range, provider, and project scoping.
func (db *DB) GetGlobalStats(ctx context.Context, opts ...StatsOption) (GlobalStats, error) {
	var o statsOpts
	for _, fn := range opts {
		fn(&o)
	}

	// Build dynamic WHERE clauses based on options
	var whereParts []string
	var whereArgs []interface{}
	if o.since != nil {
		whereParts = append(whereParts, "s.created_at >= ?")
		whereArgs = append(whereArgs, o.since.Format(time.RFC3339))
	}
	if o.until != nil {
		whereParts = append(whereParts, "s.created_at <= ?")
		whereArgs = append(whereArgs, o.until.Format(time.RFC3339))
	}
	if o.provider != "" {
		whereParts = append(whereParts, "s.provider = ?")
		whereArgs = append(whereArgs, o.provider)
	}
	if o.projectID != "" {
		whereParts = append(whereParts, "s.project_id = ?")
		whereArgs = append(whereArgs, o.projectID)
	}

	// sessionFilter is used for queries that start with "FROM sessions s" with no prior WHERE
	sessionFilter := ""
	if len(whereParts) > 0 {
		sessionFilter = " WHERE " + joinStrings(whereParts, " AND ")
	}

	// whereFilter is used for queries that already have a WHERE clause or need WHERE 1=1 prefix
	whereFilter := ""
	if len(whereParts) > 0 {
		whereFilter = " WHERE " + joinStrings(whereParts, " AND ")
	}

	var stats GlobalStats
	stats.ProviderUsage = make(map[string]int64)
	stats.ProviderTokens = make(map[string]ProviderTokens)
	stats.ModelUsage = make(map[string]int64)
	stats.ProviderSessions = make(map[string]ProviderSessionStats)

	// Total tokens including extended fields
	totalQuery := `SELECT COALESCE(SUM(e.input_tokens),0), COALESCE(SUM(e.output_tokens),0),
		COALESCE(SUM(e.cache_read_tokens),0), COALESCE(SUM(e.cache_write_tokens),0), COALESCE(SUM(e.thinking_tokens),0)
		FROM events e JOIN sessions s ON e.session_id = s.id` + whereFilter
	_ = db.QueryRowContext(ctx, totalQuery, whereArgs...).Scan(
		&stats.TotalInput, &stats.TotalOutput,
		&stats.TotalCacheRead, &stats.TotalCacheWrite, &stats.TotalThinking,
	)
	stats.TotalTokens = stats.TotalInput + stats.TotalOutput

	// Per-provider input/output/cache/thinking breakdown
	providerQuery := `
		SELECT s.provider, SUM(e.input_tokens), SUM(e.output_tokens),
			COALESCE(SUM(e.cache_read_tokens),0), COALESCE(SUM(e.cache_write_tokens),0), COALESCE(SUM(e.thinking_tokens),0)
		FROM sessions s
		JOIN events e ON s.id = e.session_id` + whereFilter + `
		GROUP BY s.provider
	`
	rows, err := db.QueryContext(ctx, providerQuery, whereArgs...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var provider string
			var input, output, cacheRead, cacheWrite, thinking int64
			if err := rows.Scan(&provider, &input, &output, &cacheRead, &cacheWrite, &thinking); err == nil {
				stats.ProviderUsage[provider] = input + output
				stats.ProviderTokens[provider] = ProviderTokens{
					Total:      input + output,
					Input:      input,
					Output:     output,
					CacheRead:  cacheRead,
					CacheWrite: cacheWrite,
					Thinking:   thinking,
				}
			}
		}
	}

	// Per-model breakdown — always needs "model != ''" so we use AND for extra filters
	modelBaseWhere := "s.model != '' AND s.model IS NOT NULL"
	if len(whereParts) > 0 {
		modelBaseWhere += " AND " + joinStrings(whereParts, " AND ")
	}
	modelQuery := `
		SELECT s.model, SUM(e.input_tokens + e.output_tokens)
		FROM sessions s
		JOIN events e ON s.id = e.session_id
		WHERE ` + modelBaseWhere + `
		GROUP BY s.model
	`
	modelRows, err := db.QueryContext(ctx, modelQuery, whereArgs...)
	if err == nil {
		defer modelRows.Close()
		for modelRows.Next() {
			var model string
			var tokens int64
			if err := modelRows.Scan(&model, &tokens); err == nil {
				stats.ModelUsage[model] = tokens
			}
		}
	}

	// Per-provider session counts and success rates — always needs "provider != ''"
	sessionBaseWhere := "provider != ''"
	if len(whereParts) > 0 {
		sessionBaseWhere += " AND " + joinStrings(whereParts, " AND ")
	}
	sessionStatsQuery := `
		SELECT provider,
			COUNT(*) as total,
			SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
			SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
			AVG(duration_seconds) as avg_duration
		FROM sessions s
		WHERE ` + sessionBaseWhere + `
		GROUP BY provider
	`
	psRows, err := db.QueryContext(ctx, sessionStatsQuery, whereArgs...)
	if err == nil {
		defer psRows.Close()
		for psRows.Next() {
			var provider string
			var ps ProviderSessionStats
			if err := psRows.Scan(&provider, &ps.Total, &ps.Completed, &ps.Failed, &ps.AvgDuration); err == nil {
				stats.ProviderSessions[provider] = ps
			}
		}
	}

	// Fetch recent sessions (limited to 50 in SQL for performance)
	recentQuery := `
		SELECT
			s.id, s.project_id, p.name, s.session_uuid, s.provider, COALESCE(s.model, ''), s.branch, s.created_at,
			COALESCE(MAX(e.timestamp), s.created_at) as updated_at,
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0)
		FROM sessions s
		LEFT JOIN projects p ON s.project_id = p.id
		LEFT JOIN events e ON s.id = e.session_id` + sessionFilter + `
		GROUP BY s.id
		ORDER BY updated_at DESC
		LIMIT 50
	`
	sessionRows, err := db.QueryContext(ctx, recentQuery, whereArgs...)
	if err == nil {
		defer sessionRows.Close()
		for sessionRows.Next() {
			var s Session
			var prjID, prjName, branch sql.NullString
			if err := sessionRows.Scan(&s.ID, &prjID, &prjName, &s.SessionUUID, &s.Provider, &s.Model, &branch, &s.CreatedAt, &s.UpdatedAt, &s.TotalInput, &s.TotalOutput); err != nil {
				continue
			}
			if prjID.Valid {
				s.ProjectID = prjID.String
			}
			if prjName.Valid {
				s.ProjectName = prjName.String
			}
			if branch.Valid {
				s.Branch = branch.String
			}
			stats.RecentSessions = append(stats.RecentSessions, s)
		}
	}

	return stats, nil
}

// joinStrings joins strings with a separator. Avoids importing strings package
// just for this one use in a file that doesn't otherwise need it.
func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}

// UpdateSessionStatus sets the status and duration for a session.
func (db *DB) UpdateSessionStatus(ctx context.Context, sessionID string, status string, durationSeconds float64) error {
	_, err := db.ExecContext(ctx, `UPDATE sessions SET status = ?, duration_seconds = ? WHERE id = ?`,
		status, durationSeconds, sessionID)
	return err
}
