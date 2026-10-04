// apps/backend/internal/studio/fake_runner.go
package studio

import (
	"context"
	"sync"
)

// FakeRunner is a test-only RunnerSpawner that records incoming messages and
// lets the test drive synthetic events to the manager's dispatch.
type FakeRunner struct {
	mu       sync.Mutex
	sessions map[string]func(Event)
	Messages map[string][]string
}

func NewFakeRunner() *FakeRunner {
	return &FakeRunner{sessions: map[string]func(Event){}, Messages: map[string][]string{}}
}

func (f *FakeRunner) HasSession(sessionID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.sessions[sessionID]
	return ok
}

func (f *FakeRunner) Spawn(ctx context.Context, sess Session, onEvent func(Event)) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.sessions[sess.ID] = onEvent
	return nil
}

func (f *FakeRunner) SendMessage(ctx context.Context, sessionID, message string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Messages[sessionID] = append(f.Messages[sessionID], message)
	return nil
}

func (f *FakeRunner) Stop(sessionID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.sessions, sessionID)
	return nil
}

// Emit pushes a synthetic event for the given session.
func (f *FakeRunner) Emit(sessionID string, ev Event) {
	f.mu.Lock()
	cb := f.sessions[sessionID]
	f.mu.Unlock()
	if cb != nil {
		cb(ev)
	}
}
