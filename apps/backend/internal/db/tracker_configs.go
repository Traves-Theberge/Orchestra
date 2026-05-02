package db

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

// TrackerConfig holds the configuration for a single tracker connection.
type TrackerConfig struct {
	ID          string
	Type        string // "github"|"linear"|"jira"|"sqlite"|"memory"
	DisplayName string
	Endpoint    string
	AuthMethod  string // "apikey"|"oauth"
	TokenEnc    string // AES-GCM encrypted via db.EncryptToken
	RefreshEnc  string // OAuth refresh token, encrypted
	TokenExpiry *int64 // Unix timestamp, nil if no expiry
	Extra       string // JSON blob
	CreatedAt   int64
	UpdatedAt   int64
}

// UpsertTrackerConfig inserts or replaces a tracker config row.
func (d *DB) UpsertTrackerConfig(ctx context.Context, cfg TrackerConfig) error {
	now := time.Now().Unix()
	if cfg.CreatedAt == 0 {
		cfg.CreatedAt = now
	}
	cfg.UpdatedAt = now
	_, err := d.ExecContext(ctx, `
		INSERT INTO tracker_configs (id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			type=excluded.type, display_name=excluded.display_name,
			endpoint=excluded.endpoint, auth_method=excluded.auth_method,
			token_enc=excluded.token_enc, refresh_enc=excluded.refresh_enc,
			token_expiry=excluded.token_expiry, extra=excluded.extra,
			updated_at=excluded.updated_at`,
		cfg.ID, cfg.Type, cfg.DisplayName, cfg.Endpoint, cfg.AuthMethod,
		cfg.TokenEnc, cfg.RefreshEnc, cfg.TokenExpiry, cfg.Extra,
		cfg.CreatedAt, cfg.UpdatedAt,
	)
	return err
}

// GetTrackerConfig returns the config with the given ID.
// Returns sql.ErrNoRows if not found.
func (d *DB) GetTrackerConfig(ctx context.Context, id string) (*TrackerConfig, error) {
	row := d.QueryRowContext(ctx, `
		SELECT id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at
		FROM tracker_configs WHERE id = ?`, id)
	return scanTrackerConfig(row)
}

// GetTrackerConfigForProject returns the tracker config assigned to the given project,
// or (nil, nil) if no config is assigned.
func (d *DB) GetTrackerConfigForProject(ctx context.Context, projectID string) (*TrackerConfig, error) {
	row := d.QueryRowContext(ctx, `
		SELECT tc.id, tc.type, tc.display_name, tc.endpoint, tc.auth_method,
			tc.token_enc, tc.refresh_enc, tc.token_expiry, tc.extra, tc.created_at, tc.updated_at
		FROM tracker_configs tc
		JOIN projects p ON p.tracker_config_id = tc.id
		WHERE p.id = ?`, projectID)
	cfg, err := scanTrackerConfig(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return cfg, err
}

// ListTrackerConfigs returns all configured tracker connections, oldest first.
func (d *DB) ListTrackerConfigs(ctx context.Context) ([]TrackerConfig, error) {
	rows, err := d.QueryContext(ctx, `
		SELECT id, type, display_name, endpoint, auth_method,
			token_enc, refresh_enc, token_expiry, extra, created_at, updated_at
		FROM tracker_configs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TrackerConfig
	for rows.Next() {
		cfg, err := scanTrackerConfig(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *cfg)
	}
	return out, rows.Err()
}

// DeleteTrackerConfig removes a tracker config by ID.
// Returns sql.ErrNoRows if no row was deleted.
func (d *DB) DeleteTrackerConfig(ctx context.Context, id string) error {
	res, err := d.ExecContext(ctx, `DELETE FROM tracker_configs WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// SetProjectTrackerConfig assigns a tracker config to a project.
// Pass an empty configID to clear the assignment.
func (d *DB) SetProjectTrackerConfig(ctx context.Context, projectID, configID string) error {
	if configID == "" {
		_, err := d.ExecContext(ctx,
			`UPDATE projects SET tracker_config_id = NULL WHERE id = ?`, projectID)
		return err
	}
	_, err := d.ExecContext(ctx,
		`UPDATE projects SET tracker_config_id = ? WHERE id = ?`, configID, projectID)
	return err
}

type trackerConfigScanner interface {
	Scan(dest ...any) error
}

func scanTrackerConfig(s trackerConfigScanner) (*TrackerConfig, error) {
	var cfg TrackerConfig
	err := s.Scan(
		&cfg.ID, &cfg.Type, &cfg.DisplayName, &cfg.Endpoint, &cfg.AuthMethod,
		&cfg.TokenEnc, &cfg.RefreshEnc, &cfg.TokenExpiry, &cfg.Extra,
		&cfg.CreatedAt, &cfg.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
