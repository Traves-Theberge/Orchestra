package observability

import (
	"testing"
	"time"
)

func TestPubSubPublishSubscribe(t *testing.T) {
	ps := NewPubSub()
	ch, unsub := ps.Subscribe(4)
	defer unsub()

	ps.Publish(Event{Type: "snapshot", Data: map[string]any{"running": 1}})

	select {
	case event := <-ch:
		if event.Type != "snapshot" {
			t.Fatalf("expected snapshot event, got %s", event.Type)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected pubsub event")
	}
}

func TestPubSubUnsubscribeStopsDelivery(t *testing.T) {
	ps := NewPubSub()
	ch, unsub := ps.Subscribe(1)
	unsub()

	ps.Publish(Event{Type: "snapshot"})
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatalf("expected closed channel after unsubscribe")
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected channel close")
	}
}

func TestPubSubPublishSetsTimestampWhenMissing(t *testing.T) {
	ps := NewPubSub()
	ch, unsub := ps.Subscribe(1)
	defer unsub()

	ps.Publish(Event{Type: "run_event", Data: map[string]any{"issue_id": "1"}})

	select {
	case event := <-ch:
		if event.Timestamp == "" {
			t.Fatalf("expected publish to set timestamp")
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected pubsub event")
	}
}

func TestPubSubPublishPreservesProvidedTimestamp(t *testing.T) {
	ps := NewPubSub()
	ch, unsub := ps.Subscribe(1)
	defer unsub()

	ps.Publish(Event{Type: "run_event", Timestamp: "2026-01-01T00:00:00Z", Data: map[string]any{"issue_id": "1"}})

	select {
	case event := <-ch:
		if event.Timestamp != "2026-01-01T00:00:00Z" {
			t.Fatalf("expected publish to preserve timestamp, got %q", event.Timestamp)
		}
	case <-time.After(1 * time.Second):
		t.Fatalf("expected pubsub event")
	}
}
