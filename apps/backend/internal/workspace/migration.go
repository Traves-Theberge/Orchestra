package workspace

import (
	"fmt"
	"os"
	"path/filepath"
)

type MigrationAction struct {
	Type   string `json:"type"`
	Source string `json:"source"`
	Target string `json:"target"`
	Note   string `json:"note,omitempty"`
}

type MigrationResult struct {
	Applied bool              `json:"applied"`
	Actions []MigrationAction `json:"actions"`
}

func PlanWorkspaceMigration(oldRoot string, newRoot string) (MigrationResult, error) {
	result := MigrationResult{Applied: false, Actions: []MigrationAction{}}

	absOld, err := filepath.Abs(oldRoot)
	if err != nil {
		return result, fmt.Errorf("resolve old workspace root: %w", err)
	}
	absNew, err := filepath.Abs(newRoot)
	if err != nil {
		return result, fmt.Errorf("resolve new workspace root: %w", err)
	}

	if absOld == absNew {
		return result, nil
	}

	oldExists := exists(absOld)
	newExists := exists(absNew)

	if !oldExists {
		return result, nil
	}

	if !newExists {
		result.Actions = append(result.Actions, MigrationAction{
			Type:   "rename_root",
			Source: absOld,
			Target: absNew,
		})
		return result, nil
	}

	entries, readErr := os.ReadDir(absOld)
	if readErr != nil {
		return result, fmt.Errorf("read old workspace root: %w", readErr)
	}

	for _, entry := range entries {
		source := filepath.Join(absOld, entry.Name())
		target := filepath.Join(absNew, entry.Name())
		if exists(target) {
			result.Actions = append(result.Actions, MigrationAction{
				Type:   "skip_conflict",
				Source: source,
				Target: target,
				Note:   "target already exists",
			})
			continue
		}

		result.Actions = append(result.Actions, MigrationAction{
			Type:   "move_entry",
			Source: source,
			Target: target,
		})
	}

	return result, nil
}

func ExecuteWorkspaceMigration(oldRoot string, newRoot string, dryRun bool) (MigrationResult, error) {
	plan, err := PlanWorkspaceMigration(oldRoot, newRoot)
	if err != nil {
		return plan, err
	}

	if dryRun || len(plan.Actions) == 0 {
		return plan, nil
	}

	for _, action := range plan.Actions {
		switch action.Type {
		case "rename_root":
			if err := os.Rename(action.Source, action.Target); err != nil {
				return plan, fmt.Errorf("rename workspace root: %w", err)
			}
		case "move_entry":
			if err := os.MkdirAll(filepath.Dir(action.Target), 0o755); err != nil {
				return plan, fmt.Errorf("prepare target parent: %w", err)
			}
			if err := os.Rename(action.Source, action.Target); err != nil {
				return plan, fmt.Errorf("move workspace entry: %w", err)
			}
		case "skip_conflict":
			continue
		}
	}

	plan.Applied = true
	return plan, nil
}
