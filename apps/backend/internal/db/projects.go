package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"path/filepath"
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

// RecordSession initializes a telemetry session and ties it to a project.
func (db *DB) RecordSession(ctx context.Context, sessionID, projectID, sessionUUID, provider, branch string) error {
	var prjID *string
	if projectID != "" {
		prjID = &projectID
	}
	
	query := `
		INSERT INTO sessions (id, project_id, session_uuid, provider, branch)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET 
			project_id = CASE WHEN sessions.project_id IS NULL OR sessions.project_id = '' THEN excluded.project_id ELSE sessions.project_id END
	`
	_, err := db.ExecContext(ctx, query, sessionID, prjID, sessionUUID, provider, branch)
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
	query := `
		INSERT INTO events (id, session_id, kind, message, raw_payload, input_tokens, output_tokens, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO NOTHING
	`
	
	// If raw payload is empty bytes, use nil so it's stored as NULL in SQLite instead of empty text
	var raw interface{}
	if len(rawPayload) > 0 {
		raw = string(rawPayload)
	}

	var tsTime interface{}
	if timestampStr != "" {
		tsTime = timestampStr
	}

	_, err := db.ExecContext(ctx, query, eventID, sessionID, kind, message, raw, inputTokens, outputTokens, tsTime)
	return err
}

type Project struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	RootPath    string `json:"root_path"`
	RemoteURL   string `json:"remote_url"`
	GitHubOwner string `json:"github_owner"`
	GitHubRepo  string `json:"github_repo"`
	GitHubToken string `json:"github_token"`
}

type ProjectStats struct {
	TotalSessions int64 `json:"total_sessions"`
	TotalInput    int64 `json:"total_input"`
	TotalOutput   int64 `json:"total_output"`
	LastActive    string `json:"last_active"`
}

func (db *DB) GetProjects(ctx context.Context) ([]Project, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, name, root_path, remote_url, COALESCE(github_owner, ''), COALESCE(github_repo, ''), COALESCE(github_token, '') FROM projects ORDER BY name ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var projects []Project
	for rows.Next() {
		var p Project
		if err := rows.Scan(&p.ID, &p.Name, &p.RootPath, &p.RemoteURL, &p.GitHubOwner, &p.GitHubRepo, &p.GitHubToken); err != nil {
			return nil, err
		}
		projects = append(projects, p)
	}
	return projects, rows.Err()
}

func (db *DB) GetProjectStats(ctx context.Context, projectID string) (ProjectStats, error) {
	query := `
		SELECT 
			COUNT(DISTINCT s.id),
			SUM(e.input_tokens),
			SUM(e.output_tokens),
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

func (db *DB) DeleteProject(ctx context.Context, projectID string) error {
	_, err := db.ExecContext(ctx, "DELETE FROM projects WHERE id = ?", projectID)
	return err
}

func (db *DB) GetProjectByID(ctx context.Context, id string) (Project, error) {
	var p Project
	err := db.QueryRowContext(ctx, "SELECT id, name, root_path, remote_url, COALESCE(github_owner, ''), COALESCE(github_repo, ''), COALESCE(github_token, '') FROM projects WHERE id = ?", id).
		Scan(&p.ID, &p.Name, &p.RootPath, &p.RemoteURL, &p.GitHubOwner, &p.GitHubRepo, &p.GitHubToken)
	return p, err
}

func (db *DB) UpdateProjectGitHubInfo(ctx context.Context, id, owner, repo string) error {
	_, err := db.ExecContext(ctx, "UPDATE projects SET github_owner = ?, github_repo = ? WHERE id = ?", owner, repo, id)
	return err
}

type Session struct {
	ID          string `json:"id"`
	ProjectID   string `json:"project_id"`
	ProjectName string `json:"project_name"`
	SessionUUID string `json:"session_uuid"`
	Provider    string `json:"provider"`
	Branch      string `json:"branch"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
	TotalInput  int64  `json:"total_input"`
	TotalOutput int64  `json:"total_output"`
}

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

type SessionDetail struct {
	Session
	Events []Event `json:"events"`
}

func (db *DB) GetSessions(ctx context.Context, projectID string) ([]Session, error) {
	var rows *sql.Rows
	var err error

	query := `
		SELECT 
			s.id, s.project_id, p.name, s.session_uuid, s.provider, s.branch, s.created_at,
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
		var prjName sql.NullString
		if err := rows.Scan(&s.ID, &s.ProjectID, &prjName, &s.SessionUUID, &s.Provider, &s.Branch, &s.CreatedAt, &s.UpdatedAt, &s.TotalInput, &s.TotalOutput); err != nil {
			return nil, err
		}
		if prjName.Valid {
			s.ProjectName = prjName.String
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

func (db *DB) GetSessionDetail(ctx context.Context, sessionID string) (*SessionDetail, error) {
	var detail SessionDetail
	
	sessionQuery := `
		SELECT 
			s.id, s.project_id, p.name, s.session_uuid, s.provider, s.branch, s.created_at,
			COALESCE(MAX(e.timestamp), s.created_at) as updated_at,
			COALESCE(SUM(e.input_tokens), 0),
			COALESCE(SUM(e.output_tokens), 0)
		FROM sessions s
		LEFT JOIN projects p ON s.project_id = p.id
		LEFT JOIN events e ON s.id = e.session_id
		WHERE s.id = ?
		GROUP BY s.id
	`
	var prjName sql.NullString
	err := db.QueryRowContext(ctx, sessionQuery, sessionID).Scan(
		&detail.ID, &detail.ProjectID, &prjName, &detail.SessionUUID, &detail.Provider, 
		&detail.Branch, &detail.CreatedAt, &detail.UpdatedAt, &detail.TotalInput, &detail.TotalOutput,
	)
	if err != nil {
		return nil, err
	}
	if prjName.Valid {
		detail.ProjectName = prjName.String
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

type GlobalStats struct {
	TotalTokens   int64            `json:"total_tokens"`
	TotalInput    int64            `json:"total_input"`
	TotalOutput   int64            `json:"total_output"`
	ProviderUsage map[string]int64 `json:"provider_usage"`
	RecentSessions []Session        `json:"recent_sessions"`
}

func (db *DB) GetGlobalStats(ctx context.Context) (GlobalStats, error) {
	var stats GlobalStats
	stats.ProviderUsage = make(map[string]int64)

	query := `SELECT SUM(input_tokens), SUM(output_tokens) FROM events`
	_ = db.QueryRowContext(ctx, query).Scan(&stats.TotalInput, &stats.TotalOutput)
	stats.TotalTokens = stats.TotalInput + stats.TotalOutput

	rows, err := db.QueryContext(ctx, `
		SELECT s.provider, SUM(e.input_tokens + e.output_tokens)
		FROM sessions s
		JOIN events e ON s.id = e.session_id
		GROUP BY s.provider
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var provider string
			var tokens int64
			if err := rows.Scan(&provider, &tokens); err == nil {
				stats.ProviderUsage[provider] = tokens
			}
		}
	}

	// Fetch recent sessions
	sessions, _ := db.GetSessions(ctx, "")
	if len(sessions) > 50 {
		stats.RecentSessions = sessions[:50]
	} else {
		stats.RecentSessions = sessions
	}

	return stats, nil
}
