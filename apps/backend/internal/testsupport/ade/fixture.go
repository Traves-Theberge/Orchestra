// Package ade provides disposable, offline boundaries for ADE verification.
// It is test support, not a provider or a certification of application behavior.
package ade

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Manifest struct {
	ID         string `json:"id"`
	Root       string `json:"root"`
	Home       string `json:"home"`
	Repository string `json:"repository"`
	Remote     string `json:"remote"`
	Worktree   string `json:"worktree"`
}

// Fixture creates only beneath its private MkdirTemp root. Exported manifest
// values are informational; ownership checks use the immutable private copy.
type Fixture struct {
	Manifest Manifest
	owned    Manifest
	env      []string
}

func NewFixture(ctx context.Context) (*Fixture, error) {
	root, err := os.MkdirTemp("", "orchestra-ade-")
	if err != nil {
		return nil, err
	}
	id := make([]byte, 16)
	if _, err := rand.Read(id); err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	m := Manifest{ID: hex.EncodeToString(id), Root: root, Home: filepath.Join(root, "home"), Repository: filepath.Join(root, "repository"), Remote: filepath.Join(root, "origin.git"), Worktree: filepath.Join(root, "worktrees", "task")}
	f := &Fixture{Manifest: m, owned: m}
	for _, dir := range []string{m.Home, m.Repository, filepath.Dir(m.Worktree), filepath.Join(root, "tmp"), filepath.Join(m.Home, "appdata"), filepath.Join(m.Home, "localappdata"), filepath.Join(m.Home, "config")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			_ = os.RemoveAll(root)
			return nil, err
		}
	}
	f.env = isolatedEnv(m)
	data, _ := json.MarshalIndent(m, "", "  ")
	if err := os.WriteFile(filepath.Join(root, "ownership.json"), data, 0600); err != nil {
		_ = os.RemoveAll(root)
		return nil, err
	}
	fail := func(err error) (*Fixture, error) { _ = f.Close(); return nil, err }
	for _, call := range []struct {
		dir  string
		args []string
	}{
		{root, []string{"init", "--bare", m.Remote}}, {m.Repository, []string{"init", "-b", "main"}},
		{m.Repository, []string{"config", "user.name", "ADE Fixture"}}, {m.Repository, []string{"config", "user.email", "ade@example.invalid"}},
	} {
		if _, err := f.Git(ctx, call.dir, call.args...); err != nil {
			return fail(err)
		}
	}
	files := map[string]string{"go.mod": "module example.invalid/ade-fixture\n\ngo 1.25\n", "answer.go": "package fixture\n\nfunc Answer() int { return 0 }\n", "answer_test.go": "package fixture\n\nimport \"testing\"\n\nfunc TestAnswer(t *testing.T) { if Answer() != 42 { t.Fatalf(\"got %d; want 42\", Answer()) } }\n"}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(m.Repository, name), []byte(content), 0600); err != nil {
			return fail(err)
		}
	}
	for _, args := range [][]string{{"add", "."}, {"commit", "-m", "fixture baseline"}, {"remote", "add", "origin", m.Remote}, {"push", "origin", "main"}, {"worktree", "add", "-b", "task-1", m.Worktree, "main"}} {
		if _, err := f.Git(ctx, m.Repository, args...); err != nil {
			return fail(err)
		}
	}
	return f, nil
}

func isolatedEnv(m Manifest) []string {
	var env []string
	for _, key := range []string{"PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT"} {
		if v, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+v)
		}
	}
	values := map[string]string{"HOME": m.Home, "USERPROFILE": m.Home, "APPDATA": filepath.Join(m.Home, "appdata"), "LOCALAPPDATA": filepath.Join(m.Home, "localappdata"), "XDG_CONFIG_HOME": filepath.Join(m.Home, "config"), "GH_CONFIG_DIR": filepath.Join(m.Home, "gh"), "TMP": filepath.Join(m.Root, "tmp"), "TEMP": filepath.Join(m.Root, "tmp"), "TMPDIR": filepath.Join(m.Root, "tmp"), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": filepath.Join(m.Home, ".gitconfig"), "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never", "GOWORK": "off", "GOPROXY": "off", "GOSUMDB": "off", "GOTOOLCHAIN": "local", "GOCACHE": filepath.Join(m.Root, "go-cache")}
	for k, v := range values {
		env = append(env, k+"="+v)
	}
	return env
}

func (f *Fixture) Env() []string { return append([]string(nil), f.env...) }

// Command never inherits credentials or Git configuration from the developer.
// Callers must supply bounded commands; this is not an arbitrary-code sandbox.
func (f *Fixture) Command(ctx context.Context, dir, command string, args ...string) (string, error) {
	if err := f.CheckOwned(dir); err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Dir = dir
	cmd.Env = f.Env()
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s failed: %w\n%s", command, err, out)
	}
	return string(out), nil
}

func (f *Fixture) Git(ctx context.Context, dir string, args ...string) (string, error) {
	return f.Command(ctx, dir, "git", args...)
}

// CheckOwned resolves links, refusing escapes even when lexically beneath root.
func (f *Fixture) CheckOwned(path string) error {
	root, err := filepath.EvalSymlinks(f.owned.Root)
	if err != nil {
		return err
	}
	if filepath.Clean(root) != filepath.Clean(f.owned.Root) {
		return fmt.Errorf("fixture root ownership changed")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("path outside owned fixture: %s", path)
	}
	return nil
}

func (f *Fixture) Close() error {
	if _, err := os.Lstat(f.owned.Root); os.IsNotExist(err) {
		return nil
	}
	if err := f.CheckOwned(f.owned.Root); err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(f.owned.Root, "ownership.json"))
	if err != nil {
		return err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	if m != f.owned {
		return fmt.Errorf("ownership manifest mismatch; refusing cleanup")
	}
	return os.RemoveAll(f.owned.Root)
}
