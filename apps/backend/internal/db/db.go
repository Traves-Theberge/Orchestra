package db

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type DB struct {
	*sql.DB
}

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

	// Manual Migrations
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN disabled_tools TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN branch_name TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN url TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN labels TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN blocked_by TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN provider TEXT")
	_, _ = db.Exec("ALTER TABLE issues ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP")
	_, _ = db.Exec("ALTER TABLE runs ADD COLUMN provider TEXT")

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

	return &DB{DB: db}, nil
}

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
			"id":           id,
			"issue_id":     issueID,
			"user_id":      userID,
			"kind":         action,
			"old_value":    oldValue,
			"new_value":    newValue,
			"timestamp":    timestamp,
			"message":      fmt.Sprintf("Action: %s", action),
		})
	}
	
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate issue history rows: %w", err)
	}
	
	return events, nil
}
