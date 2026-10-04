package agents

import (
	"os"
	"path/filepath"
	"testing"
)

func TestProjectRootWorkspaceGuard(t *testing.T) {
	root := t.TempDir()
	child := filepath.Join(root, "child")
	os.Mkdir(child, 0755)
	if err := validateTurnWorkspace(TurnRequest{WorkspaceRoot: root, Workspace: root, ProjectRootWorkspace: true}); err != nil {
		t.Fatal(err)
	}
	for _, req := range []TurnRequest{{WorkspaceRoot: root, Workspace: root}, {WorkspaceRoot: root, Workspace: child, ProjectRootWorkspace: true}, {WorkspaceRoot: root, Workspace: filepath.Dir(root), ProjectRootWorkspace: true}, {WorkspaceRoot: ".", Workspace: ".", ProjectRootWorkspace: true}} {
		if err := validateTurnWorkspace(req); err == nil {
			t.Fatalf("accepted %#v", req)
		}
	}
	if err := validateTurnWorkspace(TurnRequest{WorkspaceRoot: root, Workspace: child}); err != nil {
		t.Fatal("task descendant rejected", err)
	}
}
