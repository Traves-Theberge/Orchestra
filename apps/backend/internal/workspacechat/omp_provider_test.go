package workspacechat

import (
	"context"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

func TestWorkspaceChatListsOMPAsNativeHarness(t *testing.T) {
	svc, _, pid, _ := fixture(t, &recordingRunner{})
	find := func() Provider {
		providers, err := svc.Providers(context.Background(), pid)
		if err != nil {
			t.Fatal(err)
		}
		for _, p := range providers {
			if p.ID == string(agents.ProviderOMP) {
				return p
			}
		}
		t.Fatal("OMP missing from the harness list")
		return Provider{}
	}
	if p := find(); p.Enabled || p.Reason == "" || p.Label != "OMP" {
		t.Fatalf("unconfigured OMP must be listed as unavailable with a reason: %+v", p)
	}
	registry := svc.registry.(*agents.Registry)
	registry.SetCommand(agents.ProviderOMP, "omp -p --mode json {{prompt}}")
	registry.SetNativeCommand(agents.ProviderOMP, "omp")
	if p := find(); !p.Enabled || p.ConversationMode != "native_session" || !p.ProviderResume {
		t.Fatalf("configured OMP must be a resumable native session: %+v", p)
	}
}
