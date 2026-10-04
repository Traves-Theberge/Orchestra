package workspacechat

import (
	"context"
	"encoding/json"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"sync"
	"testing"
	"time"
)

type shutdownRegistry struct {
	*fakeNativeRegistry
	wrapped *shutdownNative
}

func (r *shutdownRegistry) StartNativeSession(ctx context.Context, p agents.Provider, req agents.TurnRequest, id string, h agents.NativeEventHandler) (agents.NativeSession, error) {
	native, err := r.fakeNativeRegistry.StartNativeSession(ctx, p, req, id, h)
	if err != nil {
		return nil, err
	}
	wrapper := &shutdownNative{fakeNative: native.(*fakeNative), closeSeen: make(chan struct{}), callbackDone: make(chan struct{})}
	r.mu.Lock()
	r.wrapped = wrapper
	r.mu.Unlock()
	return wrapper, nil
}

type shutdownNative struct {
	*fakeNative
	closeSeen    chan struct{}
	callbackDone chan struct{}
	closeOnce    sync.Once
}

func (n *shutdownNative) Close() error { n.closeOnce.Do(func() { close(n.closeSeen) }); return nil }
func (n *shutdownNative) DrainEvents(ctx context.Context) error {
	select {
	case <-n.callbackDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestCloseDrainsQueuedPersistenceBeforeDatabaseTeardown(t *testing.T) {
	old, database, fake, pid := nativeFixture(t)
	old.Close()
	r := &shutdownRegistry{fakeNativeRegistry: fake}
	s, err := New(database, r, old.roots)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "one", Text: "hello"}); err != nil {
		t.Fatal(err)
	}
	before := awaitIdle(t, s, pid, sess.ID)
	r.mu.Lock()
	native := r.wrapped
	r.mu.Unlock()
	release := make(chan struct{})
	started := make(chan struct{})
	go func() {
		close(started)
		<-release
		native.handler(agents.NativeEvent{Type: "thread/tokenUsage/updated", ThreadID: "provider-thread", TurnID: "turn", Payload: json.RawMessage(`{"threadId":"provider-thread","turnId":"turn","tokenUsage":{"total":{"totalTokens":55}}}`), Usage: &agents.NativeUsage{Total: agents.TokenUsage{TotalTokens: 55}}})
		close(native.callbackDone)
	}()
	<-started
	finished := make(chan struct{})
	go func() { s.Close(); close(finished) }()
	select {
	case <-native.closeSeen:
	case <-time.After(time.Second):
		t.Fatal("runtime was not closed")
	}
	select {
	case <-finished:
		t.Fatal("service returned before queued callback persistence")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("callback drain did not finish")
	}
	detail, err := s.DetailAfter(ctx, pid, sess.ID, before.Cursor)
	if err != nil || len(detail.Events) != 1 || detail.Events[0].Usage.Total.TotalTokens != 55 {
		t.Fatal(detail, err)
	}
	if err = database.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-native.callbackDone:
	default:
		t.Fatal("database closed before callback worker completed")
	}
}
