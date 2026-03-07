package orchestrator

import "testing"

func TestQueueRefreshCoalesces(t *testing.T) {
	service := NewService()

	first := service.QueueRefresh()
	if first.Coalesced {
		t.Fatalf("expected first refresh to not be coalesced")
	}
	if !first.Queued {
		t.Fatalf("expected first refresh to be queued")
	}

	second := service.QueueRefresh()
	if !second.Coalesced {
		t.Fatalf("expected second refresh to be coalesced")
	}

	service.CompleteRefreshCycle()

	third := service.QueueRefresh()
	if third.Coalesced {
		t.Fatalf("expected refresh to stop coalescing after completion")
	}
}

func TestSnapshotIncludesCounts(t *testing.T) {
	service := NewService()
	snapshot := service.Snapshot()

	if snapshot.Counts.Running != 0 || snapshot.Counts.Retrying != 0 {
		t.Fatalf("unexpected counts: %+v", snapshot.Counts)
	}
	if snapshot.GeneratedAt == "" {
		t.Fatalf("expected generated_at to be present")
	}
}
