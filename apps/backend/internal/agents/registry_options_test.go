package agents

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
)

type optionRecordingRunner struct{ requests []TurnRequest }

func (r *optionRecordingRunner) RunTurn(_ context.Context, request TurnRequest, _ EventHandler) (TurnResult, error) {
	r.requests = append(r.requests, request)
	return TurnResult{}, nil
}

type modelCapableRecordingRunner struct{ optionRecordingRunner }

func (*modelCapableRecordingRunner) ValidateRequestedModel(model string) error {
	if model != "fixture-model" {
		return fmt.Errorf("unsupported model %q", model)
	}
	return nil
}

type optionRecordingTransport struct {
	wraps  int
	runner Runner
}

func (t *optionRecordingTransport) WrapCommand(Provider, string) Runner { t.wraps++; return t.runner }

func TestRegistryRejectsUnsupportedRequestedOptionsBeforeRunner(t *testing.T) {
	for _, tc := range []struct {
		name       string
		request    TurnRequest
		errorField string
	}{
		{"model", TurnRequest{RequestedModel: "requested"}, "requested_model"},
		{"blank explicit model", TurnRequest{RequestedModel: " "}, "requested_model"},
		{"one turn", TurnRequest{RequestedMaxTurns: intPointer(1)}, "requested_max_turns"},
		{"many turns", TurnRequest{RequestedMaxTurns: intPointer(8)}, "requested_max_turns"},
		{"invalid zero turns", TurnRequest{RequestedMaxTurns: intPointer(0)}, "requested_max_turns"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			registry := NewRegistry(nil)
			runner := &optionRecordingRunner{}
			registry.SetRunner(ProviderClaude, runner)
			if err := registry.ValidateTurnOptions(ProviderClaude, tc.request); err == nil || !strings.Contains(err.Error(), tc.errorField) {
				t.Fatalf("validation error: %v", err)
			}
			if _, err := registry.RunTurn(context.Background(), ProviderClaude, tc.request, nil); err == nil || !strings.Contains(err.Error(), tc.errorField) {
				t.Fatalf("execution error: %v", err)
			}
			if len(runner.requests) != 0 {
				t.Fatalf("runner invoked: %+v", runner.requests)
			}
		})
	}
}

func TestRegistryRequestedModelRequiresExplicitRunnerCapability(t *testing.T) {
	registry := NewRegistry(nil)
	runner := &modelCapableRecordingRunner{}
	registry.SetRunner("FIXTURE", runner)
	request := TurnRequest{RequestedModel: "fixture-model", RuntimeTarget: RuntimeLocal}
	if err := registry.ValidateTurnOptions("FIXTURE", request); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.RunTurn(context.Background(), "FIXTURE", request, nil); err != nil {
		t.Fatal(err)
	}
	if len(runner.requests) != 1 || runner.requests[0].RequestedModel != "fixture-model" {
		t.Fatalf("request not preserved: %+v", runner.requests)
	}
	request.RequestedModel = "wrong-model"
	if _, err := registry.RunTurn(context.Background(), "FIXTURE", request, nil); err == nil {
		t.Fatal("unsupported model accepted")
	}
	registry.SetRunner("FIXTURE", &optionRecordingRunner{})
	request.RequestedModel = "fixture-model"
	if _, err := registry.RunTurn(context.Background(), "FIXTURE", request, nil); err == nil {
		t.Fatal("replacement runner inherited previous capability")
	}
}

func TestRegistryRemoteRequestedModelDoesNotBorrowLocalCapability(t *testing.T) {
	registry := NewRegistry(nil)
	runner := &modelCapableRecordingRunner{}
	transport := &optionRecordingTransport{runner: runner}
	registry.SetRunner("FIXTURE", runner)
	registry.SetTransport(RuntimeTailscale, transport)
	if _, err := registry.RunTurn(context.Background(), "FIXTURE", TurnRequest{RequestedModel: "fixture-model", RuntimeTarget: RuntimeTailscale}, nil); err == nil {
		t.Fatal("remote model accepted")
	}
	if transport.wraps != 0 || len(runner.requests) != 0 {
		t.Fatal("remote effect before rejection")
	}
	if _, err := registry.RunTurn(context.Background(), "FIXTURE", TurnRequest{RuntimeTarget: RuntimeTailscale}, nil); err != nil {
		t.Fatal(err)
	}
	if transport.wraps != 1 || len(runner.requests) != 1 {
		t.Fatal("legacy remote request not dispatched")
	}
}

func TestRegistryRejectsMissingRuntimeBeforeDispatch(t *testing.T) {
	registry := NewRegistry(nil)
	registry.SetRunner(ProviderClaude, &optionRecordingRunner{})
	if err := registry.ValidateTurnOptions(ProviderClaude, TurnRequest{RuntimeTarget: RuntimeKubernetes}); err == nil {
		t.Fatal("missing transport accepted")
	}
}

func TestRegistryConcurrentLookupAndReconfiguration(t *testing.T) {
	registry := NewRegistry(nil)
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for j := 0; j < 100; j++ {
				registry.SetCommand(ProviderClaude, "unused --command")
				registry.HasProvider(ProviderClaude)
				registry.Providers()
				registry.CommandFor(ProviderClaude)
				registry.ValidateTurnOptions(ProviderClaude, TurnRequest{RequestedModel: "unsupported"})
			}
		}()
	}
	workers.Wait()
}

func intPointer(value int) *int { return &value }
