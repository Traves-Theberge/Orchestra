package db

import (
	"database/sql"
	"fmt"
	"log"
)

// migrateColumn adds a column to a table if it doesn't already exist.
// Returns nil if the column was added or already exists.
// Returns an error only for unexpected failures.
func migrateColumn(db *sql.DB, table, column, colDef string) error {
	exists, err := columnExists(db, table, column)
	if err != nil {
		return fmt.Errorf("check column %s.%s: %w", table, column, err)
	}
	if exists {
		return nil
	}

	stmt := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, colDef)
	if _, err := db.Exec(stmt); err != nil {
		return fmt.Errorf("migrate %s.%s: %w", table, column, err)
	}
	log.Printf("migration: added column %s.%s", table, column)
	return nil
}

// columnExists checks whether a column exists on a table using PRAGMA table_info.
func columnExists(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, colType string
		var notNull int
		var dfltValue *string
		var pk int
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dfltValue, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// runMigrations applies all schema migrations with proper error checking.
func runMigrations(db *sql.DB) error {
	migrations := []struct {
		table  string
		column string
		def    string
	}{
		{"issues", "disabled_tools", "TEXT"},
		{"issues", "branch_name", "TEXT"},
		{"issues", "url", "TEXT"},
		{"issues", "labels", "TEXT"},
		{"issues", "blocked_by", "TEXT"},
		{"issues", "provider", "TEXT"},
		{"issues", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"},
		{"issues", "base_sha", "TEXT"},
		{"runs", "provider", "TEXT"},
		{"runs", "issue_identifier", "TEXT"},
		{"sessions", "issue_id", "TEXT"},
		{"sessions", "model", "TEXT"},
		{"issues", "feedback", "TEXT"},
		// Analytics: extended token tracking on events
		{"events", "cache_read_tokens", "INTEGER DEFAULT 0"},
		{"events", "cache_write_tokens", "INTEGER DEFAULT 0"},
		{"events", "thinking_tokens", "INTEGER DEFAULT 0"},
		{"events", "tool_tokens", "INTEGER DEFAULT 0"},
		// Analytics: session status and duration tracking
		{"sessions", "status", "TEXT NOT NULL DEFAULT 'unknown'"},
		{"sessions", "duration_seconds", "REAL NOT NULL DEFAULT 0"},
		{"sessions", "cost_cents", "INTEGER DEFAULT 0"},
		{"sessions", "turn_count", "INTEGER DEFAULT 0"},
		// PR URL tracking on issues
		{"issues", "pr_url", "TEXT DEFAULT ''"},
		// Agent plan stored separately from description
		{"issues", "plan", "TEXT DEFAULT ''"},
		// Tracker config assignment per project
		{"projects", "tracker_config_id", "TEXT"},
		// Runtime target for remote execution (TAILSCALE, KUBERNETES)
		{"runs", "runtime_target", "TEXT"},
		{"issues", "runtime_target", "TEXT"},
		// Per-project issue source (replaces global tracker_configs join)
		{"projects", "issue_source_type", "TEXT NOT NULL DEFAULT ''"},
		{"projects", "issue_source_endpoint", "TEXT NOT NULL DEFAULT ''"},
		{"projects", "issue_source_token", "TEXT NOT NULL DEFAULT ''"}, // AES-GCM encrypted
	}

	for _, m := range migrations {
		if err := migrateColumn(db, m.table, m.column, m.def); err != nil {
			return err
		}
	}

	// Backfill issue_source_* from tracker_configs for projects that have a
	// tracker_config_id set but no issue_source_type yet. Idempotent.
	_, _ = db.Exec(`
		UPDATE projects
		SET
			issue_source_type     = COALESCE(tc.type, ''),
			issue_source_endpoint = COALESCE(tc.endpoint, ''),
			issue_source_token    = COALESCE(tc.token_enc, '')
		FROM tracker_configs tc
		WHERE projects.tracker_config_id = tc.id
		  AND projects.issue_source_type  = ''
	`)

	return nil
}
