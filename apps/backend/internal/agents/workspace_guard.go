package agents

import (
	"fmt"
	"path/filepath"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

func validateTurnWorkspace(req TurnRequest) error {
	if !req.ProjectRootWorkspace {
		return workspace.ValidateWorkspacePath(req.WorkspaceRoot, req.Workspace)
	}
	if !filepath.IsAbs(req.WorkspaceRoot) || !filepath.IsAbs(req.Workspace) {
		return fmt.Errorf("project workspace must be absolute")
	}
	root, err := filepath.EvalSymlinks(req.WorkspaceRoot)
	if err != nil {
		return err
	}
	candidate, err := filepath.EvalSymlinks(req.Workspace)
	if err != nil {
		return err
	}
	if root != candidate {
		return fmt.Errorf("project workspace must equal the authorized project root")
	}
	return nil
}
