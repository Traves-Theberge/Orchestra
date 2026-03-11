package terminal

import (
	"fmt"
	"os"
	"os/exec"
	"sync"

	"github.com/acarl005/stripansi"
	"github.com/creack/pty"
)

type Session struct {
	ID         string
	PTY        *os.File
	Cmd        *exec.Cmd
	Handlers   []func([]byte)
	LogBuffer  []byte
	OutputChan chan []byte
	mu         sync.Mutex
	Closed     bool
}

type Manager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

func NewManager() *Manager {
	return &Manager{
		sessions: make(map[string]*Session),
	}
}

func (m *Manager) CreateSession(id string, dir string, command string, args ...string) (*Session, error) {
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
		OutputChan: make(chan []byte, 100),
	}

	m.sessions[id] = session

	go func() {
		buf := make([]byte, 1024)
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

func (m *Manager) GetOrCreateSession(id string, dir string) (*Session, error) {
	return m.CreateSession(id, dir, "/bin/bash")
}

func (m *Manager) GetSession(id string) *Session {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.sessions[id]
}

func (s *Session) broadcast(data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	
	// Keep a small buffer of the last 10KB for re-attachment
	s.LogBuffer = append(s.LogBuffer, data...)
	if len(s.LogBuffer) > 1024*10 {
		s.LogBuffer = s.LogBuffer[len(s.LogBuffer)-1024*10:]
	}

	for _, h := range s.Handlers {
		h(data)
	}

	// Non-blocking send to output channel for agents
	select {
	case s.OutputChan <- data:
	default:
	}
}

func (s *Session) AddHandler(h func([]byte)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Handlers = append(s.Handlers, h)
	
	// Replay buffer to new handler
	if len(s.LogBuffer) > 0 {
		h(s.LogBuffer)
	}
}

func (s *Session) Write(data []byte) (int, error) {
	return s.PTY.Write(data)
}

func (s *Session) GetCleanOutput() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return stripansi.Strip(string(s.LogBuffer))
}

func (s *Session) Resize(rows, cols uint16) error {
	return pty.Setsize(s.PTY, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

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
