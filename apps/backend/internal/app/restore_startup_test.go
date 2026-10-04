package app

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestRunFailsBeforeDispatchWhenSavedRequestedConfigIsCorrupt(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	for _, key := range []string{"HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"} {
		t.Setenv(key, home)
	}
	t.Setenv("ORCHESTRA_WORKSPACE_ROOT", root)
	t.Setenv("ORCHESTRA_WORKFLOW_FILE", filepath.Join(root, "absent-workflow.md"))
	t.Setenv("ORCHESTRA_SERVER_HOST", "127.0.0.1")
	t.Setenv("ORCHESTRA_AGENT_PROVIDER", "CLAUDE")
	warehouse, err := db.Connect(filepath.Join(root, ".orchestra", "warehouse.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := warehouse.Exec(`INSERT INTO issues (id, identifier, state) VALUES ('1', 'ORC-1', 'Todo')`); err != nil {
		warehouse.Close()
		t.Fatal(err)
	}
	service := orchestrator.NewService()
	service.SetDB(warehouse)
	// Inject persisted corruption independently of the normal write constraints.
	if _, err := warehouse.Exec("PRAGMA ignore_check_constraints = ON"); err != nil {
		warehouse.Close()
		t.Fatal(err)
	}
	service.SetRunningForTest([]orchestrator.RunningEntry{{IssueID: "1", IssueIdentifier: "ORC-1", Provider: "CLAUDE", State: "Todo", RequestedMaxTurns: selectionIntPointer(0)}})
	if err := service.PersistStateToDB(context.Background()); err != nil {
		warehouse.Close()
		t.Fatal(err)
	}
	if err := warehouse.Close(); err != nil {
		t.Fatal(err)
	}
	if err := Run(zerolog.Nop()); err == nil || !strings.Contains(err.Error(), "restore orchestrator state from DB") || !strings.Contains(err.Error(), "invalid restored requested_max_turns") {
		t.Fatalf("unsafe startup after corrupt saved request: %v", err)
	}
}
