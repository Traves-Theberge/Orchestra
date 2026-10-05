package workspacechat

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// Defaults ship with the backend. Existing profile files survive upgrades.
//
//go:embed maestro
var maestroDefaults embed.FS

func provisionMaestroProfile(root string) error {
	return fs.WalkDir(maestroDefaults, "maestro", func(source string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel("maestro", source)
		if err != nil {
			return err
		}
		if rel != "AGENTS.md" {
			rel = filepath.Join(".agents", "skills", rel)
		}
		target := filepath.Join(root, rel)
		if err := workspace.ValidateProjectPath(target, []string{root}); err != nil {
			return err
		}
		if info, err := os.Lstat(target); err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("Maestro profile asset is not a regular file: %s", rel)
			}
			return nil
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err := workspace.ValidateProjectPath(target, []string{root}); err != nil {
			return err
		}
		content, err := maestroDefaults.ReadFile(source)
		if err != nil {
			return err
		}
		file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return err
		}
		_, writeErr := file.Write(content)
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		return closeErr
	})
}

func readMaestroAsset(root, relative string) (string, error) {
	path := filepath.Join(root, relative)
	if err := workspace.ValidateProjectPath(path, []string{root}); err != nil {
		return "", err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("Maestro instructions must be a regular file")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

func maestroInstructions(root string) (string, error) {
	instructions, err := readMaestroAsset(root, "AGENTS.md")
	if err != nil {
		return "", err
	}
	skill, err := readMaestroAsset(root, filepath.Join(".agents", "skills", "orchestra-cli", "SKILL.md"))
	if err != nil {
		return "", err
	}
	integrations, err := readMaestroAsset(root, filepath.Join(".agents", "skills", "maestro-integrations", "SKILL.md"))
	if err != nil {
		return "", err
	}
	return "Your agent name is Maestro. The application is Orchestra.\n\n" + instructions +
		"\n\n## Loaded Orchestra CLI skill\n\n" + skill +
		"\n\n## Loaded Maestro integration skill\n\n" + integrations, nil
}
