package agents

import (
	"context"
	"path/filepath"
	"testing"
)

// A failed start must yield a true nil NativeSession: callers guard with
// `native != nil`, and a typed-nil pointer inside the interface passes that
// guard and then panics on the first method call, which crashed the backend.
func TestFailedNativeStartReturnsATrueNilSession(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-agent-binary")
	for _, provider := range []Provider{ProviderOMP, ProviderAntigravity} {
		registry := NewRegistry(map[string]string{})
		registry.SetNativeCommand(provider, missing)
		session, err := registry.StartNativeSession(context.Background(), provider, TurnRequest{Workspace: t.TempDir()}, "", func(NativeEvent) {})
		if err == nil {
			t.Fatalf("%s: starting a missing binary must fail", provider)
		}
		if session != nil {
			t.Fatalf("%s: failed start returned a non-nil session (%T), which panics when used", provider, session)
		}
	}
}
