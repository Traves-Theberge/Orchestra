package evidence

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CheckArtifacts confirms every reported artifact is a regular file inside the report directory.
// It does not inspect content for correctness or assert that a logged action occurred.
func CheckArtifacts(root string, report Report) error {
	root, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	for _, scenario := range report.Scenarios {
		for _, relative := range scenario.Artifacts {
			if strings.TrimSpace(relative) == "" || filepath.IsAbs(relative) || filepath.VolumeName(relative) != "" {
				return fmt.Errorf("artifact must be a relative path")
			}
			path := filepath.Join(root, filepath.FromSlash(relative))
			resolved, err := filepath.EvalSymlinks(path)
			if err != nil {
				return fmt.Errorf("artifact %q is unavailable: %w", relative, err)
			}
			delta, err := filepath.Rel(root, resolved)
			if err != nil || delta == ".." || strings.HasPrefix(delta, ".."+string(filepath.Separator)) || filepath.IsAbs(delta) {
				return fmt.Errorf("artifact %q escapes report directory", relative)
			}
			info, err := os.Stat(resolved)
			if err != nil || !info.Mode().IsRegular() {
				return fmt.Errorf("artifact %q is not a regular file", relative)
			}
		}
	}
	return nil
}
