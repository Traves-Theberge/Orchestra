package agents

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
)

type accountCaptureRunner struct{ requests []TurnRequest }

func (r *accountCaptureRunner) RunTurn(_ context.Context, request TurnRequest, _ EventHandler) (TurnResult, error) {
	r.requests = append(r.requests, request)
	return TurnResult{}, nil
}

func TestRegistryAccountBindingSurvivesSelectionAndScopesSecrets(t *testing.T) {
	store, err := harnessaccounts.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	first, homeFirst, err := store.BeginCodex("First")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.Complete(first.ID)
	second, homeSecond, err := store.BeginCodex("Second")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = store.Complete(second.ID)
	selected, err := store.Select("CODEX", first.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	registry := NewRegistry(nil)
	registry.SetAccountStore(store)
	capture := &accountCaptureRunner{}
	registry.SetRunner(ProviderCodex, capture)
	request := TurnRequest{RuntimeTarget: RuntimeLocal}
	if _, err := registry.RunTurn(context.Background(), ProviderCodex, request, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Select("CODEX", second.ID, selected.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.RunTurn(context.Background(), ProviderCodex, TurnRequest{AccountID: first.ID, RuntimeTarget: RuntimeLocal}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.RunTurn(context.Background(), ProviderCodex, request, nil); err != nil {
		t.Fatal(err)
	}
	if capture.requests[0].CredentialHome != homeFirst || capture.requests[1].CredentialHome != homeFirst || capture.requests[2].CredentialHome != homeSecond {
		t.Fatalf("account context drifted: %+v", capture.requests)
	}
	t.Setenv("OPENAI_API_KEY", "host-key")
	t.Setenv("CODEX_ACCESS_TOKEN", "host-token")
	t.Setenv("CODEX_HOME", "host-home")
	env := accountSubprocessEnv("one", ProviderCodex, homeFirst)
	if !slices.Contains(env, "CODEX_HOME="+homeFirst) || slices.Contains(env, "OPENAI_API_KEY=host-key") || slices.Contains(env, "CODEX_ACCESS_TOKEN=host-token") {
		t.Fatal("managed process inherited host credentials")
	}
	if _, err := registry.RunTurn(context.Background(), ProviderCodex, TurnRequest{AccountID: first.ID, RuntimeTarget: RuntimeTailscale}, nil); err == nil {
		t.Fatal("remote managed account ran without a remote credential context")
	}
	if _, err := store.Select("CODEX", "", 2); err != nil {
		t.Fatal(err)
	}
	if err := store.Remove(first.ID); err != nil && !errors.Is(err, harnessaccounts.ErrConflict) {
		t.Fatal(err)
	}
}
