package usage

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInvalidUsageStoreIsRetainedAcrossRestarts(t *testing.T) {
	for _, raw := range []string{`{"schema_version":99,"sessions":[{"id":"retained"}]}`, `{"schema_version":1,"sessions":`} {
		t.Run(raw, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "usage-codex.json")
			if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
				t.Fatal(err)
			}
			for restart := 0; restart < 2; restart++ {
				s, err := NewService(dir, nil)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := s.SetEnabled(context.Background(), ProviderCodex, false); err == nil || !strings.Contains(err.Error(), "existing file retained") {
					t.Fatalf("unsafe configuration save: %v", err)
				}
				if _, err := s.Refresh(context.Background(), ProviderCodex, true); err == nil {
					t.Fatal("refresh should reject unreadable state")
				}
				got, err := os.ReadFile(path)
				if err != nil || string(got) != raw {
					t.Fatalf("persisted file changed: %q, %v", got, err)
				}
			}
		})
	}
}

func TestUsageHistorySurvivesNewService(t *testing.T) {
	dir := t.TempDir()
	s, err := NewService(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	state, err := s.store.load(ProviderCodex)
	if err != nil {
		t.Fatal(err)
	}
	state.Sessions = []Session{{SessionID: "durable-thread"}}
	if err := s.store.save(ProviderCodex, state); err != nil {
		t.Fatal(err)
	}
	reopened, err := NewService(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.store.load(ProviderCodex)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Sessions) != 1 || got.Sessions[0].SessionID != "durable-thread" {
		t.Fatalf("history lost after reopen: %+v", got.Sessions)
	}
}
