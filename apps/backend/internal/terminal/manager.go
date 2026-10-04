// Package terminal provides pseudo-terminal session management for running
// interactive shell processes with output broadcasting and handler registration.
package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
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
}

// Manager maintains a registry of active terminal sessions and provides
// methods to create, retrieve, and close them.
type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewManager creates a new terminal Manager with an empty session registry.
func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

// CreateSession starts a new pseudo-terminal session running the given command
// in the specified directory. Returns the existing session if one with the same ID is still open.
func (m *Manager) CreateSession(id string, dir string, command string, args ...string) (*Session, error) {
	if runtime.GOOS == "windows" {
		return nil, fmt.Errorf("interactive PTY terminals are unavailable on Windows: a ConPTY adapter is required; agent subprocess execution remains supported")
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	if s, ok := m.sessions[id]; ok && !s.Closed {
		return s, nil
	}

	c := exec.Command(command, args...)
	c.Dir = dir
	c.Env = os.Environ()

	f, err := pty.Start(c)
	if err != nil {
		return nil, fmt.Errorf("failed to start pty: %v", err)
	}

	session := &Session{
		ID:         id,
		PTY:        f,
		Cmd:        c,
		Handlers:   make(map[int]func([]byte)),
		OutputChan: make(chan []byte, 100),
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

// GetOrCreateSession returns an existing session by ID or creates a new bash session
// in the given directory.
func (m *Manager) GetOrCreateSession(id string, dir string) (*Session, error) {
	return m.CreateSession(id, dir, "/bin/bash")
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
