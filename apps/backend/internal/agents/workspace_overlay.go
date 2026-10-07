package agents

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// The workspace overlay writes Orchestra-managed files into a run's cwd for
// harnesses without a per-run mechanism (agy). It never overwrites a file it
// did not create, merges JSON config instead of clobbering it, and restores
// the prior state when the last holder releases. A manifest in the temp dir
// lets a later run restore files left behind by a crash.

var errOverlayConflict = errors.New("workspace file exists and is not Orchestra-managed")

type overlayEntry struct {
	Path     string   `json:"path"`
	Existed  bool     `json:"existed"`
	Original []byte   `json:"original,omitempty"`
	Merge    bool     `json:"merge"`
	Dirs     []string `json:"dirs,omitempty"`
	refs     int
	content  []byte
}

type overlayRoot struct {
	entries map[string]*overlayEntry
}

var (
	overlayMu    sync.Mutex
	overlayRoots = map[string]*overlayRoot{}
	// overlayManifestDir is replaceable in tests.
	overlayManifestDir = filepath.Join(os.TempDir(), "orchestra-overlays")
)

// workspaceOverlay is one run's set of acquired overlay paths.
type workspaceOverlay struct {
	root  string
	paths []string
	once  sync.Once
}

func newWorkspaceOverlay(root string) (*workspaceOverlay, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	overlayMu.Lock()
	defer overlayMu.Unlock()
	if _, ok := overlayRoots[abs]; !ok {
		recoverOverlayLocked(abs)
		overlayRoots[abs] = &overlayRoot{entries: map[string]*overlayEntry{}}
	}
	return &workspaceOverlay{root: abs}, nil
}

func overlayManifestPath(root string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(root)))
	return filepath.Join(overlayManifestDir, hex.EncodeToString(sum[:8])+".json")
}

// recoverOverlayLocked restores files a crashed process left in root.
func recoverOverlayLocked(root string) {
	raw, err := os.ReadFile(overlayManifestPath(root))
	if err != nil {
		return
	}
	var entries []overlayEntry
	if json.Unmarshal(raw, &entries) == nil {
		for i := range entries {
			restoreOverlayEntry(&entries[i])
		}
	}
	_ = os.Remove(overlayManifestPath(root))
}

func saveOverlayManifestLocked(root string, state *overlayRoot) {
	path := overlayManifestPath(root)
	if len(state.entries) == 0 {
		_ = os.Remove(path)
		return
	}
	entries := make([]overlayEntry, 0, len(state.entries))
	for _, e := range state.entries {
		entries = append(entries, *e)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	raw, err := json.Marshal(entries)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o700)
	_ = os.WriteFile(path, raw, 0o600)
}

func restoreOverlayEntry(e *overlayEntry) {
	if e.Existed {
		_ = os.WriteFile(e.Path, e.Original, 0o644)
	} else {
		_ = os.Remove(e.Path)
	}
	for i := len(e.Dirs) - 1; i >= 0; i-- {
		_ = os.Remove(e.Dirs[i]) // only removes empty directories
	}
}

func (o *workspaceOverlay) resolve(rel string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if filepath.IsAbs(clean) || clean == "." || strings.HasPrefix(clean, "..") {
		return "", fmt.Errorf("overlay path %q escapes the workspace", rel)
	}
	return filepath.Join(o.root, clean), nil
}

func mkdirTracked(dir string) ([]string, error) {
	missing := []string{}
	for cur := dir; ; cur = filepath.Dir(cur) {
		if _, err := os.Stat(cur); err == nil {
			break
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
		missing = append(missing, cur)
		if filepath.Dir(cur) == cur {
			break
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	// Outermost first so restoration can remove innermost first.
	for i, j := 0, len(missing)-1; i < j; i, j = i+1, j-1 {
		missing[i], missing[j] = missing[j], missing[i]
	}
	return missing, nil
}

// create writes a new file. Re-acquiring identical content shares it; a file
// not created by Orchestra is never overwritten (errOverlayConflict).
func (o *workspaceOverlay) create(rel string, content []byte) error {
	path, err := o.resolve(rel)
	if err != nil {
		return err
	}
	overlayMu.Lock()
	defer overlayMu.Unlock()
	state := overlayRoots[o.root]
	if e, ok := state.entries[path]; ok {
		if e.Merge || !bytes.Equal(e.content, content) {
			return errOverlayConflict
		}
		e.refs++
		o.paths = append(o.paths, path)
		return nil
	}
	if _, err := os.Lstat(path); err == nil {
		return errOverlayConflict
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	dirs, err := mkdirTracked(filepath.Dir(path))
	if err != nil {
		return err
	}
	if err = os.WriteFile(path, content, 0o644); err != nil {
		return err
	}
	state.entries[path] = &overlayEntry{Path: path, Dirs: dirs, refs: 1, content: content}
	o.paths = append(o.paths, path)
	saveOverlayManifestLocked(o.root, state)
	return nil
}

// mergeJSONObject adds entries under key (e.g. "mcpServers") to a JSON file,
// keeping every existing entry. The original bytes are restored on release.
func (o *workspaceOverlay) mergeJSONObject(rel, key string, additions map[string]any) ([]string, error) {
	path, err := o.resolve(rel)
	if err != nil {
		return nil, err
	}
	overlayMu.Lock()
	defer overlayMu.Unlock()
	state := overlayRoots[o.root]
	e, held := state.entries[path]
	current, readErr := os.ReadFile(path)
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return nil, readErr
	}
	if held && !e.Merge {
		return nil, errOverlayConflict
	}
	doc := map[string]any{}
	if len(bytes.TrimSpace(current)) > 0 {
		if err := json.Unmarshal(current, &doc); err != nil {
			return nil, fmt.Errorf("existing %s is not valid JSON; refusing to modify it: %w", rel, err)
		}
	}
	section, _ := doc[key].(map[string]any)
	if section == nil {
		section = map[string]any{}
	}
	added := []string{}
	names := make([]string, 0, len(additions))
	for name := range additions {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if _, exists := section[name]; exists {
			continue // never clobber a user's (or another holder's) entry
		}
		section[name] = additions[name]
		added = append(added, name)
	}
	if !held {
		e = &overlayEntry{Path: path, Merge: true, Existed: readErr == nil, Original: current}
		dirs, err := mkdirTracked(filepath.Dir(path))
		if err != nil {
			return nil, err
		}
		e.Dirs = dirs
		state.entries[path] = e
	}
	e.refs++
	o.paths = append(o.paths, path)
	if len(added) > 0 || !held {
		doc[key] = section
		raw, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return nil, err
		}
		if err = os.WriteFile(path, append(raw, '\n'), 0o644); err != nil {
			return nil, err
		}
	}
	saveOverlayManifestLocked(o.root, state)
	return added, nil
}

// copyDir copies a skill directory into rel, file by file, as created files.
func (o *workspaceOverlay) copyDir(src, rel string) error {
	if info, err := os.Stat(src); err == nil && !info.IsDir() {
		data, err := os.ReadFile(src)
		if err != nil {
			return err
		}
		return o.create(filepath.Join(rel, "SKILL.md"), data)
	}
	return filepath.WalkDir(src, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		sub, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return o.create(filepath.Join(rel, sub), data)
	})
}

// release restores every path this run acquired once no other holder remains.
func (o *workspaceOverlay) release() {
	if o == nil {
		return
	}
	o.once.Do(func() {
		overlayMu.Lock()
		defer overlayMu.Unlock()
		state := overlayRoots[o.root]
		if state == nil {
			return
		}
		for i := len(o.paths) - 1; i >= 0; i-- {
			e := state.entries[o.paths[i]]
			if e == nil {
				continue
			}
			e.refs--
			if e.refs <= 0 {
				restoreOverlayEntry(e)
				delete(state.entries, o.paths[i])
			}
		}
		saveOverlayManifestLocked(o.root, state)
	})
}
