package usage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const schemaVersion = 1

// store persists per-provider scan state to JSON on disk with atomic writes.
type store struct {
	dir string
	mu  sync.Mutex
	mem map[Provider]*PersistedState
}

func newStore(dir string) (*store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("usage store mkdir: %w", err)
	}
	return &store{dir: dir, mem: map[Provider]*PersistedState{}}, nil
}

func (s *store) path(p Provider) string {
	return filepath.Join(s.dir, fmt.Sprintf("usage-%s.json", p))
}

// load returns the PersistedState for the provider, reading from disk on
// first call and caching afterwards.
func (s *store) load(p Provider) (*PersistedState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.mem[p]; ok {
		return existing, nil
	}
	state := &PersistedState{
		SchemaVersion: schemaVersion,
		Provider:      p,
	}
	path := s.path(p)
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			s.mem[p] = state
			return state, nil
		}
		return nil, fmt.Errorf("usage store read: %w", err)
	}
	var parsed PersistedState
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("usage store decode %s: %w; existing file retained", path, err)
	}
	if parsed.SchemaVersion != schemaVersion {
		return nil, fmt.Errorf("usage store %s: unsupported schema version %d (supported %d); existing file retained", path, parsed.SchemaVersion, schemaVersion)
	}
	parsed.Provider = p
	s.mem[p] = &parsed
	return &parsed, nil
}

// save writes the state atomically (temp file + rename).
func (s *store) save(p Provider, state *PersistedState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state.SchemaVersion = schemaVersion
	state.Provider = p

	raw, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("usage store marshal: %w", err)
	}
	final := s.path(p)
	tmp := fmt.Sprintf("%s.%d.%d.tmp", final, os.Getpid(), time.Now().UnixNano())
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return fmt.Errorf("usage store write tmp: %w", err)
	}
	if err := os.Rename(tmp, final); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("usage store rename: %w", err)
	}
	s.mem[p] = state
	return nil
}
