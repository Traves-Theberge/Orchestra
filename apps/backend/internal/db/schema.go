package db

// Schema is the DDL applied on database initialization. It creates all core
// tables (projects, sessions, events, issues, runs, ingest_offsets, mcp_servers,
// issue_history) and their indexes using CREATE TABLE IF NOT EXISTS.
const Schema = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	root_path TEXT UNIQUE NOT NULL,
	remote_url TEXT NOT NULL,
	github_owner TEXT,
	github_repo TEXT,
	github_token TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	session_uuid TEXT NOT NULL,
	provider TEXT NOT NULL,
	branch TEXT,
	issue_id TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);

CREATE TABLE IF NOT EXISTS events (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	message TEXT,
	raw_payload TEXT,
	input_tokens INTEGER DEFAULT 0,
	output_tokens INTEGER DEFAULT 0,
	timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);

CREATE TABLE IF NOT EXISTS issues (
	id TEXT PRIMARY KEY,
	identifier TEXT NOT NULL,
	title TEXT,
	description TEXT,
	state TEXT NOT NULL,
	assignee_id TEXT,
	project_id TEXT,
	priority INTEGER DEFAULT 0,
	branch_name TEXT,
	url TEXT,
	labels TEXT,
	blocked_by TEXT,
	provider TEXT,
	disabled_tools TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issues_identifier ON issues(identifier);

CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	issue_id TEXT NOT NULL,
	session_id TEXT,
	provider TEXT NOT NULL,
	state TEXT NOT NULL,
	last_event TEXT,
	last_message TEXT,
	turn_count INTEGER DEFAULT 0,
	input_tokens INTEGER DEFAULT 0,
	output_tokens INTEGER DEFAULT 0,
	total_tokens INTEGER DEFAULT 0,
	FOREIGN KEY (issue_id) REFERENCES issues(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_issue_id ON runs(issue_id);

CREATE TABLE IF NOT EXISTS ingest_offsets (
	file_path TEXT PRIMARY KEY,
	bytes_read INTEGER NOT NULL DEFAULT 0,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_servers (
	id TEXT PRIMARY KEY,
	name TEXT UNIQUE NOT NULL,
	command TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS issue_history (
	id TEXT PRIMARY KEY,
	issue_id TEXT NOT NULL,
	user_id TEXT,
	action TEXT NOT NULL,
	old_value TEXT,
	new_value TEXT,
	timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (issue_id) REFERENCES issues(id)
);

CREATE INDEX IF NOT EXISTS idx_issue_history_issue_id ON issue_history(issue_id);

CREATE TABLE IF NOT EXISTS daily_metrics (
	date         TEXT NOT NULL,
	project_id   TEXT NOT NULL DEFAULT '',
	provider     TEXT NOT NULL DEFAULT '',
	model        TEXT NOT NULL DEFAULT '',
	input_tokens   INTEGER DEFAULT 0,
	output_tokens  INTEGER DEFAULT 0,
	cache_read     INTEGER DEFAULT 0,
	cache_write    INTEGER DEFAULT 0,
	thinking       INTEGER DEFAULT 0,
	cost_cents     INTEGER DEFAULT 0,
	request_count  INTEGER DEFAULT 0,
	session_count  INTEGER DEFAULT 0,
	completed      INTEGER DEFAULT 0,
	failed         INTEGER DEFAULT 0,
	avg_duration   REAL DEFAULT 0,
	PRIMARY KEY (date, project_id, provider, model)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS api_requests (
	id             TEXT PRIMARY KEY,
	session_id     TEXT NOT NULL,
	provider       TEXT NOT NULL,
	model          TEXT NOT NULL,
	input_tokens   INTEGER DEFAULT 0,
	output_tokens  INTEGER DEFAULT 0,
	latency_ms     INTEGER DEFAULT 0,
	status_code    INTEGER DEFAULT 200,
	error_type     TEXT,
	rate_limit_remaining_requests INTEGER,
	rate_limit_remaining_tokens   INTEGER,
	created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_requests_session ON api_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_api_requests_time ON api_requests(created_at);

CREATE TABLE IF NOT EXISTS session_git_metrics (
	session_id      TEXT PRIMARY KEY,
	lines_added     INTEGER DEFAULT 0,
	lines_removed   INTEGER DEFAULT 0,
	files_changed   INTEGER DEFAULT 0,
	test_files      INTEGER DEFAULT 0,
	commits         INTEGER DEFAULT 0,
	hunks           INTEGER DEFAULT 0,
	pr_url          TEXT,
	pr_merged       INTEGER DEFAULT 0,
	ci_passed       INTEGER DEFAULT -1,
	created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS external_usage (
	id          TEXT PRIMARY KEY,
	provider    TEXT NOT NULL,
	source      TEXT NOT NULL,
	date        TEXT NOT NULL,
	model       TEXT,
	input_tokens  INTEGER,
	output_tokens INTEGER,
	cost_cents    INTEGER,
	raw_data      TEXT,
	synced_at     TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_external_usage_date ON external_usage(date, provider);

CREATE TABLE IF NOT EXISTS budgets (
	id          TEXT PRIMARY KEY,
	project_id  TEXT,
	provider    TEXT,
	period      TEXT NOT NULL,
	limit_cents INTEGER NOT NULL,
	alert_pct   INTEGER DEFAULT 80,
	created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tracker_configs (
	id           TEXT PRIMARY KEY,
	type         TEXT NOT NULL,
	display_name TEXT NOT NULL,
	endpoint     TEXT,
	auth_method  TEXT NOT NULL DEFAULT 'apikey',
	token_enc    TEXT,
	refresh_enc  TEXT,
	token_expiry INTEGER,
	extra        TEXT,
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
`
