package db

import (
	"context"

	"github.com/google/uuid"
)

type MCPServerRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
}

func (d *DB) ListMCPServers(ctx context.Context) ([]MCPServerRecord, error) {
	query := "SELECT id, name, command FROM mcp_servers ORDER BY name ASC"
	rows, err := d.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []MCPServerRecord
	for rows.Next() {
		var r MCPServerRecord
		if err := rows.Scan(&r.ID, &r.Name, &r.Command); err != nil {
			return nil, err
		}
		records = append(records, r)
	}
	return records, nil
}

func (d *DB) CreateMCPServer(ctx context.Context, name, command string) (*MCPServerRecord, error) {
	id := uuid.New().String()
	query := "INSERT INTO mcp_servers (id, name, command) VALUES (?, ?, ?)"
	_, err := d.ExecContext(ctx, query, id, name, command)
	if err != nil {
		return nil, err
	}
	return &MCPServerRecord{ID: id, Name: name, Command: command}, nil
}

func (d *DB) UpdateMCPServer(ctx context.Context, id, name, command string) error {
	query := "UPDATE mcp_servers SET name = ?, command = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
	_, err := d.ExecContext(ctx, query, name, command, id)
	return err
}

func (d *DB) DeleteMCPServer(ctx context.Context, id string) error {
	query := "DELETE FROM mcp_servers WHERE id = ?"
	_, err := d.ExecContext(ctx, query, id)
	return err
}
