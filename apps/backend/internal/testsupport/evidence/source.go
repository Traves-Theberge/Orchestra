package evidence

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Fingerprint identifies the working source, including untracked nonignored files.
// Reports/artifacts should live outside this tree so generating evidence does not change it.
func Fingerprint(ctx context.Context, root string) (Source, error) {
	var source Source
	root, err := filepath.Abs(root)
	if err != nil {
		return source, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return source, err
	}
	git := func(args ...string) ([]byte, error) {
		command := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
		command.Env = sourceGitEnv()
		return command.Output()
	}
	gitRoot, err := git("rev-parse", "--show-toplevel")
	if err != nil {
		return source, fmt.Errorf("resolve source root: %w", err)
	}
	actualRoot := filepath.Clean(filepath.FromSlash(strings.TrimSpace(string(gitRoot))))
	// Use Git's canonical root when a caller supplies a subdirectory.
	root, err = filepath.EvalSymlinks(actualRoot)
	if err != nil {
		return source, err
	}
	revision, err := git("rev-parse", "HEAD")
	if err != nil {
		return source, fmt.Errorf("read source revision: %w", err)
	}
	source.Revision = strings.TrimSpace(string(revision))
	listed, err := git("ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name")
	if err != nil {
		return source, fmt.Errorf("list source files: %w", err)
	}
	paths := strings.Split(strings.TrimSuffix(string(listed), "\x00"), "\x00")
	sort.Strings(paths)
	hash := sha256.New()
	write := func(data []byte) {
		_ = binary.Write(hash, binary.BigEndian, uint64(len(data)))
		_, _ = hash.Write(data)
	}
	write([]byte("orchestra-source-v2"))
	previous := ""
	for _, relative := range paths {
		if relative == "" || relative == previous {
			continue
		}
		previous = relative
		local := filepath.Join(root, filepath.FromSlash(relative))
		delta, err := filepath.Rel(root, local)
		if err != nil || delta == ".." || strings.HasPrefix(delta, ".."+string(filepath.Separator)) || filepath.IsAbs(delta) {
			return Source{}, fmt.Errorf("source path escapes root")
		}
		// Lstat protects only the leaf; ReadFile would otherwise follow a
		// replaced parent directory outside this checkout. Missing tracked
		// directories still require checking their nearest existing ancestor.
		if err := checkSourceParent(root, filepath.Dir(local)); err != nil {
			return Source{}, fmt.Errorf("source path %q: %w", relative, err)
		}
		write([]byte(relative))
		info, err := os.Lstat(local)
		if os.IsNotExist(err) {
			write([]byte("deleted"))
			continue
		}
		if err != nil {
			return Source{}, fmt.Errorf("inspect source path %q: %w", relative, err)
		}
		var data []byte
		switch {
		case info.Mode()&os.ModeSymlink != 0:
			write([]byte("symlink"))
			target, readErr := os.Readlink(local)
			err, data = readErr, []byte(target)
		case info.Mode().IsRegular():
			write([]byte("file"))
			write([]byte(fmt.Sprintf("%03o", info.Mode().Perm()&0o111)))
			data, err = os.ReadFile(local)
		default:
			return Source{}, fmt.Errorf("unsupported source path %q", relative)
		}
		if err != nil {
			return Source{}, fmt.Errorf("read source path %q: %w", relative, err)
		}
		write(data)
	}
	source.TreeFingerprint = hex.EncodeToString(hash.Sum(nil))
	return source, nil
}

func sourceGitEnv() []string {
	var env []string
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TMP", "TEMP", "TMPDIR":
			env = append(env, entry)
		}
	}
	return append(env, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_OPTIONAL_LOCKS=0", "GIT_TERMINAL_PROMPT=0")
}

func checkSourceParent(root, parent string) error {
	for {
		_, err := os.Lstat(parent)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			return err
		}
		next := filepath.Dir(parent)
		if next == parent {
			return fmt.Errorf("no existing source ancestor")
		}
		parent = next
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("source parent escapes root")
	}
	return nil
}
