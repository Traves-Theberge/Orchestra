// Package terminal provides pseudo-terminal session management for running
// interactive shell processes with output broadcasting and handler registration.
package terminal

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/acarl005/stripansi"
	"github.com/creack/pty"
)

// Session represents an active pseudo-terminal session with an underlying process,
// output buffering, and handler-based output broadcasting.
type Session struct {
	ID            string
	PTY           *os.File
	Cmd           *exec.Cmd
	Handlers      map[int]func([]byte)
	nextHandlerID int
	LogBuffer     []byte
	OutputChan    chan []byte
	mu            sync.Mutex
	Closed        bool
	envScoped     bool
	envSignature  [32]byte
}

// Manager maintains a registry of active terminal sessions and provides
// methods to create, retrieve, and close them.
type Manager struct {
	sessions            map[string]*Session
	removingDirectories map[string]struct{}
	mu                  sync.RWMutex
}

// NewManager creates a new terminal Manager with an empty session registry.
func NewManager() *Manager {
	return &Manager{
		sessions:            make(map[string]*Session),
		removingDirectories: make(map[string]struct{}),
	}
}

// CreateSession starts a new pseudo-terminal session running the given command
// in the specified directory. Returns the existing session if one with the same ID is still open.
func (m *Manager) CreateSession(id string, dir string, command string, args ...string) (*Session, error) {
	return m.createSession(id, dir, nil, command, args...)
}

// CreateSessionWithEnv starts a shell with an explicit process environment.
// An existing session can only be reused with the same environment context.
func (m *Manager) CreateSessionWithEnv(id string, dir string, env []string, command string, args ...string) (*Session, error) {
	if env == nil {
		return nil, fmt.Errorf("explicit terminal environment is required")
	}
	return m.createSession(id, dir, env, command, args...)
}

func (m *Manager) createSession(id string, dir string, env []string, command string, args ...string) (*Session, error) {
	if runtime.GOOS == "windows" {
		return nil, fmt.Errorf("interactive PTY terminals are unavailable on Windows: a ConPTY adapter is required; agent subprocess execution remains supported")
	}
	scoped := env != nil
	signature := terminalEnvSignature(env)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, removing := m.removingDirectories[canonicalDirectory(dir)]; removing {
		return nil, fmt.Errorf("workspace is being removed")
	}

	if s, ok := m.sessions[id]; ok {
		s.mu.Lock()
		closed := s.Closed
		s.mu.Unlock()
		if !closed {
			if s.envScoped != scoped || (scoped && s.envSignature != signature) {
				return nil, fmt.Errorf("terminal session environment changed; close the existing terminal before continuing")
			}
			return s, nil
		}
	}

	c := exec.Command(command, args...)
	c.Dir = dir
	if scoped {
		c.Env = append([]string(nil), env...)
	} else {
		c.Env = os.Environ()
	}

	f, err := pty.Start(c)
	if err != nil {
		return nil, fmt.Errorf("failed to start pty: %v", err)
	}

	session := &Session{
		ID:           id,
		PTY:          f,
		Cmd:          c,
		Handlers:     make(map[int]func([]byte)),
		OutputChan:   make(chan []byte, 100),
		envScoped:    scoped,
		envSignature: signature,
	}

	m.sessions[id] = session

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := f.Read(buf)
			if err != nil {
				session.Close()
				break
			}
			if n > 0 {
				data := make([]byte, n)
				copy(data, buf[:n])
				session.broadcast(data)
			}
		}
	}()

	return session, nil
}

func terminalEnvSignature(env []string) [32]byte {
	// ORCHESTRA_SESSION_ID can change between turns in one persistent issue
	// shell. The provider credential context must remain stable.
	var values []string
	for _, entry := range env {
		if !strings.HasPrefix(entry, "ORCHESTRA_SESSION_ID=") {
			values = append(values, entry)
		}
	}
	return sha256.Sum256([]byte(strings.Join(values, "\x00")))
}

// ActiveDirectories returns the exact working directories of current PTY sessions.
func (m *Manager) ActiveDirectories() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	result := make([]string, 0, len(m.sessions))
	for _, session := range m.sessions {
		session.mu.Lock()
		closed := session.Closed
		dir := ""
		if session.Cmd != nil {
			dir = session.Cmd.Dir
		}
		session.mu.Unlock()
		if !closed && dir != "" {
			result = append(result, dir)
		}
	}
	return result
}

// BeginDirectoryRemoval prevents a new PTY from opening in dir while its worktree is removed.
// The returned release function must run after the filesystem mutation completes.
func (m *Manager) BeginDirectoryRemoval(dir string) (func(), error) {
	key := canonicalDirectory(dir)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.removingDirectories[key]; exists {
		return nil, fmt.Errorf("workspace terminal admission is already fenced")
	}
	for _, session := range m.sessions {
		session.mu.Lock()
		closed := session.Closed
		cwd := ""
		if session.Cmd != nil {
			cwd = session.Cmd.Dir
		}
		session.mu.Unlock()
		if !closed && cwd != "" && canonicalDirectory(cwd) == key {
			return nil, fmt.Errorf("an active terminal is using this workspace")
		}
	}
	m.removingDirectories[key] = struct{}{}
	var once sync.Once
	return func() {
		once.Do(func() {
			m.mu.Lock()
			delete(m.removingDirectories, key)
			m.mu.Unlock()
		})
	}, nil
}

func canonicalDirectory(dir string) string {
	path := filepath.Clean(dir)
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = filepath.Clean(resolved)
	}
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return path
}

// GetOrCreateSession returns an existing session by ID or creates a new bash session
// in the given directory.
func (m *Manager) GetOrCreateSession(id string, dir string) (*Session, error) {
	return m.CreateSession(id, dir, "/bin/bash")
}

func (m *Manager) GetOrCreateSessionWithEnv(id string, dir string, env []string) (*Session, error) {
	return m.CreateSessionWithEnv(id, dir, env, "/bin/bash")
}

// GetSession returns the session with the given ID, or nil if not found.
func (m *Manager) GetSession(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

func (s *Session) broadcast(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.LogBuffer = append(s.LogBuffer, data...)
	if len(s.LogBuffer) > 1024*100 { // 100KB buffer
		s.LogBuffer = s.LogBuffer[len(s.LogBuffer)-1024*100:]
	}

	for _, h := range s.Handlers {
		h(data)
	}

	select {
	case s.OutputChan <- data:
	default:
	}
}

// AddHandler registers a callback that receives terminal output data and returns
// a handler ID for later removal. The handler immediately receives any buffered output.
func (s *Session) AddHandler(h func([]byte)) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.nextHandlerID
	s.nextHandlerID++
	s.Handlers[id] = h

	if len(s.LogBuffer) > 0 {
		h(s.LogBuffer)
	}
	return id
}

// RemoveHandler unregisters the output handler with the given ID.
func (s *Session) RemoveHandler(id int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Handlers, id)
}

// CloseSession closes and removes the session with the given ID.
func (m *Manager) CloseSession(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[id]; ok {
		s.Close()
		delete(m.sessions, id)
	}
}

// Write sends input data to the terminal's pseudo-terminal.
func (s *Session) Write(data []byte) (int, error) {
	return s.PTY.Write(data)
}

// GetCleanOutput returns the buffered terminal output with ANSI escape sequences stripped.
func (s *Session) GetCleanOutput() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return stripansi.Strip(string(s.LogBuffer))
}

// Resize changes the terminal window size to the given dimensions.
func (s *Session) Resize(rows, cols uint16) error {
	return pty.Setsize(s.PTY, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

// Close terminates the session by closing the PTY, killing the process, and closing the output channel.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Closed {
		return
	}
	s.Closed = true
	s.PTY.Close()
	if s.Cmd.Process != nil {
		s.Cmd.Process.Kill()
	}
	close(s.OutputChan)
}
