package db

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
)

func testTrackerDB(t *testing.T) *DB {
	t.Helper()
	dir := t.TempDir()
	d, err := Connect(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func TestTrackerConfigCRUD(t *testing.T) {
	d := testTrackerDB(t)
	ctx := context.Background()

	cfg := TrackerConfig{
		ID:          "tc-1",
		Type:        "linear",
		DisplayName: "Linear ENG",
		Endpoint:    "ENG",
		AuthMethod:  "apikey",
		TokenEnc:    "tok",
	}

	if err := d.UpsertTrackerConfig(ctx, cfg); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	got, err := d.GetTrackerConfig(ctx, "tc-1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.DisplayName != "Linear ENG" {
		t.Errorf("display_name: got %q, want %q", got.DisplayName, "Linear ENG")
	}
	if got.CreatedAt == 0 || got.UpdatedAt == 0 {
		t.Errorf("expected non-zero timestamps, got created=%d updated=%d", got.CreatedAt, got.UpdatedAt)
	}

	list, err := d.ListTrackerConfigs(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("list len: got %d, want 1", len(list))
	}

	// Update via upsert
	cfg.DisplayName = "Linear ENG (renamed)"
	if err := d.UpsertTrackerConfig(ctx, cfg); err != nil {
		t.Fatalf("upsert update: %v", err)
	}
	got, _ = d.GetTrackerConfig(ctx, "tc-1")
	if got.DisplayName != "Linear ENG (renamed)" {
		t.Errorf("after upsert: got %q, want renamed", got.DisplayName)
	}

	// Delete
	if err := d.DeleteTrackerConfig(ctx, "tc-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := d.GetTrackerConfig(ctx, "tc-1"); err == nil {
		t.Error("expected error after delete, got nil")
	}

	// Delete nonexistent should return sql.ErrNoRows
	err = d.DeleteTrackerConfig(ctx, "nonexistent")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("delete nonexistent: got %v, want sql.ErrNoRows", err)
	}
}

func TestTrackerConfigGetForProject(t *testing.T) {
	d := testTrackerDB(t)
	ctx := context.Background()

	// Insert a project
	_, err := d.ExecContext(ctx, `
		INSERT INTO projects (id, name, root_path, remote_url)
		VALUES ('proj-1', 'Test Project', '/tmp/proj', 'https://github.com/test/repo')
	`)
	if err != nil {
		t.Fatalf("insert project: %v", err)
	}

	// No tracker config assigned — should return nil, nil
	cfg, err := d.GetTrackerConfigForProject(ctx, "proj-1")
	if err != nil {
		t.Fatalf("get for project (unassigned): %v", err)
	}
	if cfg != nil {
		t.Errorf("expected nil config for unassigned project, got %+v", cfg)
	}

	// Upsert a tracker config and assign it
	tc := TrackerConfig{
		ID:          "tc-proj",
		Type:        "github",
		DisplayName: "GitHub",
		AuthMethod:  "apikey",
	}
	if err := d.UpsertTrackerConfig(ctx, tc); err != nil {
		t.Fatalf("upsert tracker config: %v", err)
	}
	if _, err := d.ExecContext(ctx, `UPDATE projects SET issue_source_type='github', issue_source_endpoint='owner/repo', issue_source_token='old-secret' WHERE id='proj-1'`); err != nil {
		t.Fatalf("set legacy embedded source: %v", err)
	}
	if err := d.SetProjectTrackerConfig(ctx, "proj-1", "missing-config"); !errors.Is(err, ErrTrackerConfigNotFound) {
		t.Fatalf("link unknown config: got %v, want ErrTrackerConfigNotFound", err)
	}
	var unchangedType, unchangedEndpoint, unchangedToken string
	if err := d.QueryRowContext(ctx, `SELECT issue_source_type, issue_source_endpoint, issue_source_token FROM projects WHERE id='proj-1'`).Scan(&unchangedType, &unchangedEndpoint, &unchangedToken); err != nil {
		t.Fatalf("read project after rejected link: %v", err)
	}
	if unchangedType != "github" || unchangedEndpoint != "owner/repo" || unchangedToken != "old-secret" {
		t.Fatalf("unknown config link changed active source: %q %q %q", unchangedType, unchangedEndpoint, unchangedToken)
	}
	if err := d.SetProjectTrackerConfig(ctx, "proj-1", "tc-proj"); err != nil {
		t.Fatalf("set project tracker config: %v", err)
	}
	var linkedID, issueType, endpoint, token string
	if err := d.QueryRowContext(ctx, `SELECT COALESCE(tracker_config_id,''), issue_source_type, issue_source_endpoint, issue_source_token FROM projects WHERE id='proj-1'`).Scan(&linkedID, &issueType, &endpoint, &token); err != nil {
		t.Fatalf("read project after link: %v", err)
	}
	if linkedID != "tc-proj" || issueType != "" || endpoint != "" || token != "" {
		t.Fatalf("link must atomically select only linked config; got id=%q type=%q endpoint=%q token=%q", linkedID, issueType, endpoint, token)
	}

	cfg, err = d.GetTrackerConfigForProject(ctx, "proj-1")
	if err != nil {
		t.Fatalf("get for project (assigned): %v", err)
	}
	if cfg == nil {
		t.Fatal("expected non-nil config, got nil")
	}
	if cfg.ID != "tc-proj" {
		t.Errorf("config ID: got %q, want %q", cfg.ID, "tc-proj")
	}

	// Clear the assignment
	if err := d.SetProjectTrackerConfig(ctx, "proj-1", ""); err != nil {
		t.Fatalf("clear tracker config: %v", err)
	}
	cfg, err = d.GetTrackerConfigForProject(ctx, "proj-1")
	if err != nil {
		t.Fatalf("get after clear: %v", err)
	}
	if cfg != nil {
		t.Errorf("expected nil after clear, got %+v", cfg)
	}
	if err := d.SetProjectTrackerConfig(ctx, "proj-1", "tc-proj"); err != nil {
		t.Fatalf("relink tracker config: %v", err)
	}
	if err := d.UpdateProjectIssueSource(ctx, "proj-1", "github", "owner/repo", "new-secret"); err != nil {
		t.Fatalf("switch to embedded source: %v", err)
	}
	var switchedID, switchedType, switchedEndpoint, switchedToken string
	if err := d.QueryRowContext(ctx, `SELECT COALESCE(tracker_config_id,''), issue_source_type, issue_source_endpoint, issue_source_token FROM projects WHERE id='proj-1'`).Scan(&switchedID, &switchedType, &switchedEndpoint, &switchedToken); err != nil {
		t.Fatalf("read project after source switch: %v", err)
	}
	if switchedID != "" || switchedType != "github" || switchedEndpoint != "owner/repo" {
		t.Fatalf("embedded source update must atomically clear linked config; got id=%q type=%q endpoint=%q", switchedID, switchedType, switchedEndpoint)
	}
	if switchedToken == "" {
		t.Fatal("embedded source update did not store its encrypted token")
	}
	if err := d.UpdateProjectIssueSource(ctx, "proj-1", "github", "owner/repo", ""); err != nil {
		t.Fatalf("preserve same-provider token: %v", err)
	}
	var sameProviderToken string
	if err := d.QueryRowContext(ctx, `SELECT issue_source_token FROM projects WHERE id='proj-1'`).Scan(&sameProviderToken); err != nil {
		t.Fatalf("read same-provider token: %v", err)
	}
	if sameProviderToken != switchedToken {
		t.Fatal("same-provider edit should retain an omitted token")
	}
	if err := d.UpdateProjectIssueSource(ctx, "proj-1", "linear", "https://api.linear.app/graphql", ""); err != nil {
		t.Fatalf("switch provider without token: %v", err)
	}
	var switchedProviderToken string
	if err := d.QueryRowContext(ctx, `SELECT issue_source_token FROM projects WHERE id='proj-1'`).Scan(&switchedProviderToken); err != nil {
		t.Fatalf("read token after provider switch: %v", err)
	}
	if switchedProviderToken != "" {
		t.Fatal("provider switch should not retain the previous provider token")
	}

	// SetProjectTrackerConfig on a missing project must return sql.ErrNoRows
	err = d.SetProjectTrackerConfig(ctx, "missing", "tc-proj")
	if !errors.Is(err, sql.ErrNoRows) {
		t.Errorf("set on missing project: got %v, want sql.ErrNoRows", err)
	}
}

// TestTrackerConfigNullColumns verifies that NULL values in nullable TEXT columns
// don't break Scan. Inserts a row via raw SQL bypassing UpsertTrackerConfig.
func TestTrackerConfigNullColumns(t *testing.T) {
	d := testTrackerDB(t)
	ctx := context.Background()

	_, err := d.ExecContext(ctx, `
		INSERT INTO tracker_configs (id, type, display_name, auth_method, created_at, updated_at)
		VALUES ('tc-null', 'github', 'GitHub', 'apikey', 100, 100)
	`)
	if err != nil {
		t.Fatalf("raw insert: %v", err)
	}

	got, err := d.GetTrackerConfig(ctx, "tc-null")
	if err != nil {
		t.Fatalf("get with NULLs: %v", err)
	}
	if got.Endpoint != "" || got.TokenEnc != "" || got.RefreshEnc != "" || got.Extra != "" {
		t.Errorf("expected empty strings for NULL columns, got %+v", got)
	}

	list, err := d.ListTrackerConfigs(ctx)
	if err != nil {
		t.Fatalf("list with NULLs: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("list len: got %d, want 1", len(list))
	}
}
