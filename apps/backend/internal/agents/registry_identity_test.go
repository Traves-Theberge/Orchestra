package agents

import (
	"context"
	"testing"
)

type identityRunner struct{ calls int }

func (r *identityRunner) RunTurn(context.Context, TurnRequest, EventHandler) (TurnResult, error) {
	r.calls++
	return TurnResult{Output: "identity fixture"}, nil
}

func TestRegistryHarnessIdentityIsCanonicalAtEveryBoundary(t *testing.T) {
	r := NewRegistry(map[string]string{" custom ": "fixture-command"})
	fixture := &identityRunner{}
	r.SetRunner(" custom ", fixture)
	if !r.HasProvider("CuStOm") {
		t.Fatal("registered identity depends on query spelling")
	}
	if command, ok := r.CommandFor(" custom "); !ok || command != "fixture-command" {
		t.Fatal(command, ok)
	}
	if err := r.ValidateTurnOptions("custom", TurnRequest{}); err != nil {
		t.Fatal(err)
	}
	result, err := r.RunTurn(context.Background(), " custom ", TurnRequest{}, nil)
	if err != nil || fixture.calls != 1 || result.Output != "identity fixture" {
		t.Fatal(result, err, fixture.calls)
	}
	if providers := r.Providers(); len(providers) != 1 || providers[0] != "CUSTOM" {
		t.Fatal(providers)
	}
}
