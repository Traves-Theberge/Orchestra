package harnesssetup

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestObserveSeparatesRegistrationInstallationAndAuthentication(t *testing.T) {
	called := 0
	rows := Observe(context.Background(), []string{"codex", "claude"}, map[string]string{"CODEX": "codex exec {{prompt}}"}, func(name string) (string, error) {
		if name == "codex" {
			return "/usr/bin/codex", nil
		}
		return "", errors.New("missing")
	}, func(_ context.Context, path string) (Observation, error) {
		called++
		if path != "/usr/bin/codex" {
			t.Fatalf("unexpected probe path %q", path)
		}
		return SignedIn, nil
	})
	if len(rows) != 5 || called != 1 {
		t.Fatalf("rows=%d auth probes=%d", len(rows), called)
	}
	if got := rows[0]; !got.Registered || !got.CommandConfigured || got.Installation != Detected || got.Authentication != SignedIn {
		t.Fatalf("unexpected Codex observation: %+v", got)
	}
	if got := rows[1]; !got.Registered || got.CommandConfigured || got.Installation != Missing || got.Authentication != Unknown {
		t.Fatalf("unexpected Claude observation: %+v", got)
	}
	seenAntigravity, seenGemini := false, false
	for _, row := range rows {
		seenAntigravity = seenAntigravity || row.ID == "ANTIGRAVITY"
		seenGemini = seenGemini || row.ID == "GEMINI"
	}
	if !seenAntigravity || seenGemini {
		t.Fatalf("active harness inventory should include Antigravity and retire Gemini: %+v", rows)
	}
}

func TestObserveNeverExecutesConfiguredCommandOrPromotesFailedAuth(t *testing.T) {
	rows := Observe(context.Background(), nil, map[string]string{"CODEX": "dangerous shell text"}, func(name string) (string, error) {
		if name == "codex" {
			return "/usr/bin/codex", nil
		}
		return "", errors.New("missing")
	}, func(context.Context, string) (Observation, error) { return Unknown, errors.New("probe failed") })
	if rows[0].Registered || !rows[0].CommandConfigured || rows[0].Authentication != Unknown {
		t.Fatalf("failed probe became ready: %+v", rows[0])
	}
}

func TestObserveUsesConfiguredAbsoluteExecutableWithoutRunningAuthProbe(t *testing.T) {
	custom := filepath.Join(t.TempDir(), "custom codex")
	probes := 0
	rows := Observe(context.Background(), []string{"CODEX"}, map[string]string{"CODEX": `"` + custom + `" exec {{prompt}}`}, func(name string) (string, error) {
		if name == custom {
			return custom, nil
		}
		return "", errors.New("not found")
	}, func(context.Context, string) (Observation, error) {
		probes++
		return SignedIn, nil
	})
	if rows[0].Installation != Detected || rows[0].Executable != custom || rows[0].Authentication != Unknown || probes != 0 {
		t.Fatalf("custom binary must be discovered without auth execution: %+v, probes=%d", rows[0], probes)
	}
}

func TestCodexStatusDoesNotTurnGenericFailureIntoSignedOut(t *testing.T) {
	if state, err := classifyCodexStatus(errors.New("CLI failed"), "Not logged in"); state != Unknown || err == nil {
		t.Fatalf("non-exit failure must stay unknown: state=%q err=%v", state, err)
	}
	var output limitedOutput
	chunk := make([]byte, 8192)
	if count, err := output.Write(chunk); err != nil || count != len(chunk) || len(output.data) != 4096 {
		t.Fatalf("status output was not bounded: count=%d err=%v retained=%d", count, err, len(output.data))
	}
}
