package checkpoint

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
)

// Links (symlinks, Windows junctions and other reparse points) inside the
// worktree may point anywhere, including back at the worktree or at folders
// outside it. Nothing behind a link is ever snapshotted, written or deleted.

// isLinkMode reports whether a file mode is a symlink or a reparse point. Go
// reports Windows junctions as ModeIrregular (Go 1.23+) or ModeSymlink.
func isLinkMode(m fs.FileMode) bool {
	return m&(fs.ModeSymlink|fs.ModeIrregular) != 0
}

// isLink reports whether the entry at full (described by its Lstat mode) is
// a link. On Windows a directory that Readlink can resolve is a junction too,
// whatever the Go version reports.
func isLink(full string, mode fs.FileMode) bool {
	if isLinkMode(mode) {
		return true
	}
	if runtime.GOOS == "windows" && mode.IsDir() {
		if _, err := os.Readlink(full); err == nil {
			return true
		}
	}
	return false
}

// isDirLink reports whether full is a link that leads (or may lead) to a
// directory: junctions and other reparse points always, symlinks when their
// target is a directory.
func isDirLink(full string, mode fs.FileMode) bool {
	if !isLink(full, mode) {
		return false
	}
	if mode&fs.ModeSymlink == 0 {
		return true // junction, mount point or another reparse point
	}
	st, err := os.Stat(full)
	return err == nil && st.IsDir()
}

func notExist(err error) bool {
	return errors.Is(err, fs.ErrNotExist) || errors.Is(err, syscall.ENOTDIR)
}

// linkCache remembers, per slash-separated directory, why paths below it must
// not be touched ("" means they may).
type linkCache map[string]string

func (lc linkCache) parent(root, dir string) string {
	if r, ok := lc[dir]; ok {
		return r
	}
	r := ""
	full := filepath.Join(root, filepath.FromSlash(dir))
	if fi, err := os.Lstat(full); err != nil {
		if !notExist(err) {
			r = fmt.Sprintf("cannot check %q for links: %v", dir, err)
		}
	} else if isLink(full, fi.Mode()) {
		r = fmt.Sprintf("%q is a symlink or junction; paths behind a link are never touched", dir)
	}
	lc[dir] = r
	return r
}

// blocked returns why rel must not be snapshotted, written or deleted, or ""
// if it may: some parent directory is a link, or rel itself is a link to a
// directory. A link to a file is fine (it is handled as the link itself).
func (lc linkCache) blocked(root, rel string) string {
	for i := 0; i < len(rel); i++ {
		if rel[i] == '/' {
			if r := lc.parent(root, rel[:i]); r != "" {
				return r
			}
		}
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	fi, err := os.Lstat(full)
	if err != nil {
		if notExist(err) {
			return ""
		}
		return fmt.Sprintf("cannot check %q for links: %v", rel, err)
	}
	if isDirLink(full, fi.Mode()) {
		return fmt.Sprintf("%q is a link to a directory (symlink or junction); it is never replaced or followed", rel)
	}
	return ""
}

// excludePattern turns a slash-separated path into an anchored gitignore
// pattern that matches exactly that path.
func excludePattern(rel string) string {
	var b strings.Builder
	b.WriteByte('/')
	for _, r := range rel {
		switch r {
		case '\\', '*', '?', '[', ']', '!', '#', ' ':
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}
