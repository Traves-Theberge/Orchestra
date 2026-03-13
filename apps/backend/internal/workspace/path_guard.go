package workspace

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var sanitizeIssueIDPattern = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func WorkspacePath(root string, issueIdentifier string, provider string) (string, error) {
	if strings.TrimSpace(issueIdentifier) == "" {
		return "", errors.New("issue identifier is required")
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve workspace root: %w", err)
	}

	normalized := sanitizeIssueIDPattern.ReplaceAllString(strings.TrimSpace(issueIdentifier), "_")
	dirName := normalized
	if provider != "" {
		dirName = fmt.Sprintf("%s-%s", normalized, strings.ToLower(provider))
	}
	path := filepath.Join(absRoot, dirName)

	if err := ValidateWorkspacePath(absRoot, path); err != nil {
		return "", err
	}

	return path, nil
}

func ValidateWorkspacePath(root string, candidate string) error {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return fmt.Errorf("resolve workspace root: %w", err)
	}

	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return fmt.Errorf("resolve workspace candidate: %w", err)
	}

	if absCandidate == absRoot {
		return fmt.Errorf("workspace equals root: %s", absRoot)
	}

	if !isWithinRoot(absRoot, absCandidate) {
		return fmt.Errorf("workspace escapes root: workspace=%s root=%s", absCandidate, absRoot)
	}

	if exists(absCandidate) {
		evaluated, evalErr := filepath.EvalSymlinks(absCandidate)
		if evalErr == nil {
			if !isWithinRoot(absRoot, evaluated) {
				return fmt.Errorf("workspace symlink escape: workspace=%s root=%s", absCandidate, absRoot)
			}
		}
	}

	return nil
}

func ValidateProjectPath(candidate string, allowedRoots []string) error {
	absCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return fmt.Errorf("resolve project candidate: %w", err)
	}

	// NEW: Whitelist logic. If no specific roots, but it's a known project path, allow it.
	// This is handled via the DB check in the API layer, but we keep this for legacy logic.

	// Always allow if within one of the project roots
	for _, root := range allowedRoots {
		if strings.TrimSpace(root) == "" {
			continue
		}
		absRoot, err := filepath.Abs(root)
		if err != nil {
			continue
		}

		if isWithinRoot(absRoot, absCandidate) || absRoot == absCandidate {
			return nil
		}
	}

	// Also allow common user development directories if no roots configured
	if len(allowedRoots) == 0 {
		home, _ := os.UserHomeDir()
		if home != "" {
			absHome, _ := filepath.Abs(home)
			if isWithinRoot(absHome, absCandidate) || absHome == absCandidate {
				return nil
			}
		}
	}

	return fmt.Errorf("path not allowed: %s (allowed roots: %v)", absCandidate, allowedRoots)
}

func isWithinRoot(root string, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}

	return rel != "." && rel != "" && !strings.HasPrefix(rel, "..") && rel != ".."
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}
