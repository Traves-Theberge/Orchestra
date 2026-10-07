package db

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

// MCPServerRecord represents a persisted Orchestra-managed MCP server. Legacy
// rows carry a full shell command line in Command with empty Args.
type MCPServerRecord struct {
	ID      string            `json:"id"`
	Name    string            `json:"name"`
	Command string            `json:"command"`
	Type    string            `json:"type"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Enabled bool              `json:"enabled"`
}

func normalizeMCPRecord(r *MCPServerRecord) {
	if r.Type == "" {
		r.Type = "local"
		if r.URL != "" && r.Command == "" {
			r.Type = "remote"
		}
	}
	if r.Args == nil {
		r.Args = []string{}
	}
	if r.Env == nil {
		r.Env = map[string]string{}
	}
	if r.Headers == nil {
		r.Headers = map[string]string{}
	}
}

// ListMCPServers returns all MCP server records ordered by name.
func (d *DB) ListMCPServers(ctx context.Context) ([]MCPServerRecord, error) {
	query := "SELECT id, name, command, type, args, env, url, headers, enabled FROM mcp_servers ORDER BY name ASC"
	rows, err := d.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MCPServerRecord
	for rows.Next() {
		var r MCPServerRecord
		var args, env, headers string
		var enabled int
		if err := rows.Scan(&r.ID, &r.Name, &r.Command, &r.Type, &args, &env, &r.URL, &headers, &enabled); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(args), &r.Args)
		_ = json.Unmarshal([]byte(env), &r.Env)
		_ = json.Unmarshal([]byte(headers), &r.Headers)
		r.Enabled = enabled != 0
		normalizeMCPRecord(&r)
		records = append(records, r)
	}
	return records, rows.Err()
}

// CreateMCPServer inserts a new MCP server record and returns it with a generated UUID.
func (d *DB) CreateMCPServer(ctx context.Context, name, command string) (*MCPServerRecord, error) {
	return d.CreateMCPServerRecord(ctx, MCPServerRecord{Name: name, Command: command, Enabled: true})
}

// CreateMCPServerRecord inserts a full MCP server definition.
func (d *DB) CreateMCPServerRecord(ctx context.Context, r MCPServerRecord) (*MCPServerRecord, error) {
	r.ID = uuid.New().String()
	normalizeMCPRecord(&r)
	args, _ := json.Marshal(r.Args)
	env, _ := json.Marshal(r.Env)
	headers, _ := json.Marshal(r.Headers)
	enabled := 0
	if r.Enabled {
		enabled = 1
	}
	_, err := d.ExecContext(ctx, "INSERT INTO mcp_servers (id, name, command, type, args, env, url, headers, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		r.ID, r.Name, r.Command, r.Type, string(args), string(env), r.URL, string(headers), enabled)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// UpdateMCPServer modifies the name and command of an existing MCP server record.
func (d *DB) UpdateMCPServer(ctx context.Context, id, name, command string) error {
	query := "UPDATE mcp_servers SET name = ?, command = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
	_, err := d.ExecContext(ctx, query, name, command, id)
	return err
}

// DeleteMCPServer removes an MCP server record by its ID.
func (d *DB) DeleteMCPServer(ctx context.Context, id string) error {
	query := "DELETE FROM mcp_servers WHERE id = ?"
	_, err := d.ExecContext(ctx, query, id)
	return err
}
