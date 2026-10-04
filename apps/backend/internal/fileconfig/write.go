// Package fileconfig writes private configuration without changing process-wide permissions.
package fileconfig

import (
	"fmt"
	"os"
	"path/filepath"
)

// WritePrivate replaces a config only after its private temporary file is fully written.
// On Windows private access is enforced with an ACL, not POSIX mode bits.
func WritePrivate(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	if err := protect(dir, true); err != nil {
		return fmt.Errorf("protect config directory: %w", err)
	}
	f, err := os.CreateTemp(dir, ".config-*")
	if err != nil {
		return fmt.Errorf("create config temporary file: %w", err)
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	defer f.Close()
	if err := protect(tmp, false); err != nil {
		return fmt.Errorf("protect config file: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	if err := f.Sync(); err != nil {
		return fmt.Errorf("sync config: %w", err)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("close config: %w", err)
	}
	if err := replace(tmp, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}
