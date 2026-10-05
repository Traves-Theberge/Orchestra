// Package db provides the SQLite-backed data layer for orchestrad, including
// schema management, migrations, session and event recording, project tracking,
// MCP server persistence, and token encryption.
package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// DB wraps a *sql.DB connection to the orchestrad SQLite warehouse database.
type DB struct {
	*sql.DB
}

// Connect opens (or creates) the SQLite database at dbPath, applies the schema
// and migrations, and returns a ready-to-use DB handle. The database uses WAL
// journal mode and foreign key enforcement.
func Connect(dbPath string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("create db directory: %w", err)
	}

	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", dbPath)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Set connection pool limits
	db.SetMaxOpenConns(1) // modernc.org/sqlite is safe for concurrent access, but a single write connection is standard for SQLite
	db.SetMaxIdleConns(1)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	if _, err := db.Exec(Schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS harness_registration (
		provider TEXT PRIMARY KEY,
		registered INTEGER NOT NULL CHECK (registered IN (0, 1)),
		version INTEGER NOT NULL CHECK (version > 0)
	)`); err != nil {
		return nil, fmt.Errorf("apply harness registration schema: %w", err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS harness_command_overrides (
		provider TEXT PRIMARY KEY,
		command TEXT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("apply harness command schema: %w", err)
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS harness_default_selection (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		provider TEXT NOT NULL
	)`); err != nil {
		return nil, fmt.Errorf("apply harness default schema: %w", err)
	}

	// Schema migrations with proper error handling
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS issue_history (
		id TEXT PRIMARY KEY,
		issue_id TEXT NOT NULL,
		user_id TEXT,
		action TEXT NOT NULL,
		old_value TEXT,
		new_value TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (issue_id) REFERENCES issues(id)
	);`); err != nil {
		return nil, fmt.Errorf("failed to create issue_history table: %w", err)
	}

	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_issue_history_issue_id ON issue_history(issue_id);`); err != nil {
		return nil, fmt.Errorf("failed to create idx_issue_history_issue_id index: %w", err)
	}

	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS worktree_removal_requests (
		request_id TEXT PRIMARY KEY,
		project_id TEXT NOT NULL,
		workspace_id TEXT NOT NULL,
		digest TEXT NOT NULL,
		receipt TEXT NOT NULL,
		status TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`); err != nil {
		return nil, fmt.Errorf("failed to create worktree removal receipts: %w", err)
	}

	return &DB{DB: db}, nil
}

// GetEvents returns all issue_history entries for the given issue ID, ordered
// by timestamp descending.
func (db *DB) GetEvents(ctx context.Context, issueID string) ([]map[string]any, error) {
	query := `
		SELECT id, issue_id, user_id, action, old_value, new_value, timestamp
		FROM issue_history 
		WHERE issue_id = ? 
		ORDER BY timestamp DESC
	`

	rows, err := db.QueryContext(ctx, query, issueID)
	if err != nil {
		return nil, fmt.Errorf("query issue history: %w", err)
	}
	defer rows.Close()

	var events []map[string]any
	for rows.Next() {
		var id, issueID, userID, action, oldValue, newValue, timestamp string
		if err := rows.Scan(&id, &issueID, &userID, &action, &oldValue, &newValue, &timestamp); err != nil {
			return nil, fmt.Errorf("scan issue history row: %w", err)
		}

		events = append(events, map[string]any{
			"id":        id,
			"issue_id":  issueID,
			"user_id":   userID,
			"kind":      action,
			"old_value": oldValue,
			"new_value": newValue,
			"timestamp": timestamp,
			"message":   fmt.Sprintf("Action: %s", action),
		})
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate issue history rows: %w", err)
	}

	return events, nil
}
