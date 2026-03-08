package db

const Schema = `
CREATE TABLE IF NOT EXISTS projects (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	root_path TEXT UNIQUE NOT NULL,
	remote_url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	session_uuid TEXT NOT NULL,
	provider TEXT NOT NULL,
	branch TEXT,
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
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_issues_identifier ON issues(identifier);

CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	issue_id TEXT NOT NULL,
	session_id TEXT,
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
`
