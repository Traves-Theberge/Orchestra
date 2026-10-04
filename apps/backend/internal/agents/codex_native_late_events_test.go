package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestNativeLateIdleUsageAndNotificationBurst(t *testing.T) {
	observed := make(chan NativeEvent, 1000)
	s, err := nativeFixture(t, "late", "", func(e NativeEvent) { observed <- e })
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.SendTurn(context.Background(), "hello", "")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	lateUsage := 0
	idleEvents := 0
	completed := 0
	for lateUsage < 1 || idleEvents < 600 {
		select {
		case e := <-observed:
			if e.ThreadID != "thread-fixture" || e.TurnID == "unknown-turn" || e.TurnID == "stale-turn" {
				t.Fatalf("foreign/stale event emitted %+v", e)
			}
			if e.Type == "turn/completed" {
				completed++
			}
			if e.Type == "thread/status/changed" {
				idleEvents++
			}
			if e.Type == "thread/tokenUsage/updated" && e.Usage.Total.TotalTokens == 123 {
				if e.TurnID != result.TurnID {
					t.Fatal("late usage misattributed")
				}
				lateUsage++
			}
		case <-deadline:
			t.Fatalf("idle stream not observed usage=%d events=%d", lateUsage, idleEvents)
		}
	}
	if completed != 1 || lateUsage != 1 {
		t.Fatalf("callbacks duplicated terminal=%d usage=%d", completed, lateUsage)
	}
	if _, err = s.(NativeModelCatalogProvider).ListModels(context.Background()); err != nil {
		t.Fatalf("idle process unhealthy %v", err)
	}
}

func TestNativeCloseDrainsAlreadyReadEventsBeforeCallbackBarrier(t *testing.T) {
	// The synthetic late frame is already read and queued; the observer remains
	// blocked to prove Close can reap without waiting on itself and Drain joins it.
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	observed := make(chan NativeEvent, 1000)
	s, err := nativeFixture(t, "normal", "", func(e NativeEvent) {
		if e.Type == "item/agentMessage/delta" {
			once.Do(func() { close(entered); <-release })
		}
		observed <- e
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SendTurn(context.Background(), "turn", ""); err != nil {
		t.Fatal(err)
	}
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("observer not entered")
	}
	concrete := s.(*codexNativeSession)
	raw := json.RawMessage(`{"threadId":"thread-fixture","turnId":"turn-1","tokenUsage":{"last":{"totalTokens":321},"total":{"totalTokens":321}}}`)
	concrete.events <- nativeRPC{Method: "thread/tokenUsage/updated", Params: raw}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	drained := make(chan error, 1)
	go func() { drained <- concrete.DrainEvents(context.Background()) }()
	select {
	case <-drained:
		t.Fatal("closed drain returned before callback completed")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	select {
	case err := <-drained:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("callbacks did not drain")
	}
	found := false
	for len(observed) > 0 {
		e := <-observed
		if e.Type == "thread/tokenUsage/updated" && e.Usage.Total.TotalTokens == 321 {
			found = true
		}
	}
	if !found {
		t.Fatal("already-read late usage dropped during close")
	}
}

func TestNativeIdleCallbackCanSendAnotherTurnAndRPC(t *testing.T) {
	var s NativeSession
	done := make(chan error, 1)
	s, err := nativeFixture(t, "late-reentrant", "", func(e NativeEvent) {
		if e.Type != "thread/tokenUsage/updated" || e.TurnID != "turn-1" || e.Usage.Total.TotalTokens != 123 {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if _, err := s.(NativeModelCatalogProvider).ListModels(ctx); err != nil {
			done <- err
			return
		}
		r, err := s.SendTurn(ctx, "from observer", "")
		if err == nil && r.TurnID != "turn-2" {
			err = fmt.Errorf("wrong nested turn %s", r.TurnID)
		}
		done <- err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SendTurn(context.Background(), "first", ""); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("observer RPC/turn deadlocked")
	}
	drainNativeEvents(t, s)
}
