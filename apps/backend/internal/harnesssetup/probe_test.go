package harnesssetup

import (
	"context"
	"errors"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOpenCodeCredentialCatalogReportsEntriesWithoutCredentials(t *testing.T) {
	count, err := classifyOpenCodeCredentialCatalog([]byte(`[{"provider":"anthropic","secret":"never-return"},{"provider":"openai"}]`))
	if err != nil || count != 2 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	for _, malformed := range []string{`{"credentials":[]}`, `null`, `not json`} {
		if _, err := classifyOpenCodeCredentialCatalog([]byte(malformed)); err == nil {
			t.Fatalf("trusted malformed catalog: %q", malformed)
		}
	}
}

func TestObserveSeparatesRegistrationInstallationAndAuthentication(t *testing.T) {
	called := 0
	rows := Observe(context.Background(), []string{"codex", "claude"}, map[string]string{"CODEX": "codex exec {{prompt}}"}, func(name string) (string, error) {
		if name == "codex" {
			return "/usr/bin/codex", nil
		}
		return "", errors.New("missing")
	}, func(_ context.Context, id string, path string) (Observation, error) {
		called++
		if id != "CODEX" || path != "/usr/bin/codex" {
			t.Fatalf("unexpected probe %s at %q", id, path)
		}
		return SignedIn, nil
	})
	if len(rows) != 6 || called != 1 {
		t.Fatalf("rows=%d auth probes=%d", len(rows), called)
	}
	if got := rows[0]; !got.Registered || !got.CommandConfigured || got.Installation != Detected || got.Authentication != SignedIn {
		t.Fatalf("unexpected Codex observation: %+v", got)
	}
	if got := rows[1]; !got.Registered || got.CommandConfigured || got.Installation != Missing || got.Authentication != Unknown {
		t.Fatalf("unexpected Claude observation: %+v", got)
	}
	seenAntigravity, seenOMP, seenGemini := false, false, false
	for _, row := range rows {
		seenAntigravity = seenAntigravity || row.ID == "ANTIGRAVITY"
		seenOMP = seenOMP || row.ID == "OMP"
		seenGemini = seenGemini || row.ID == "GEMINI"
	}
	if !seenAntigravity || !seenOMP || seenGemini {
		t.Fatalf("active harness inventory should include Antigravity and retire Gemini: %+v", rows)
	}
}

func TestObserveNeverExecutesConfiguredCommandOrPromotesFailedAuth(t *testing.T) {
	rows := Observe(context.Background(), nil, map[string]string{"CODEX": "dangerous shell text"}, func(name string) (string, error) {
		if name == "codex" {
			return "/usr/bin/codex", nil
		}
		return "", errors.New("missing")
	}, func(context.Context, string, string) (Observation, error) { return Unknown, errors.New("probe failed") })
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
	}, func(context.Context, string, string) (Observation, error) {
		probes++
		return SignedIn, nil
	})
	if rows[0].Installation != Detected || rows[0].Executable != custom || rows[0].Authentication != Unknown || probes != 0 {
		t.Fatalf("custom binary must be discovered without auth execution: %+v, probes=%d", rows[0], probes)
	}
}

func TestObserveProbesClaudeWithoutAssumingOtherProvidersAreSignedIn(t *testing.T) {
	rows := Observe(context.Background(), []string{"CLAUDE", "OPENCODE"}, nil, func(name string) (string, error) {
		return "/usr/bin/" + name, nil
	}, func(_ context.Context, id string, _ string) (Observation, error) {
		if id != "CLAUDE" && id != "CODEX" {
			t.Fatalf("unsupported provider %s was probed", id)
		}
		return SignedIn, nil
	})
	if rows[1].Authentication != SignedIn || rows[2].Authentication != Unknown {
		t.Fatalf("unexpected auth observations: Claude=%s OpenCode=%s", rows[1].Authentication, rows[2].Authentication)
	}
}

func TestClassifyClaudeStatusRequiresConsistentStructuredResult(t *testing.T) {
	for _, test := range []struct {
		name   string
		output string
		want   Observation
	}{
		{"signed in", `{"loggedIn":true,"authMethod":"claude.ai"}`, SignedIn},
		{"missing login flag", `{"authMethod":"claude.ai"}`, Unknown},
		{"missing method", `{"loggedIn":true}`, Unknown},
		{"malformed", `not json`, Unknown},
		{"contradictory", `{"loggedIn":false,"authMethod":"none"}`, Unknown},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := classifyClaudeStatus(nil, []byte(test.output))
			if got != test.want || (test.want == Unknown && err == nil) {
				t.Fatalf("status=%q err=%v, want %q", got, err, test.want)
			}
		})
	}
}

func TestClassifyClaudeSignedOutRequiresDocumentedExitCode(t *testing.T) {
	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		command = exec.Command("cmd", "/c", "exit", "1")
	} else {
		command = exec.Command("sh", "-c", "exit 1")
	}
	err := command.Run()
	if state, classifyErr := classifyClaudeStatus(err, []byte(`{"loggedIn":false,"authMethod":"none"}`)); state != SignedOut || classifyErr != nil {
		t.Fatalf("status=%q err=%v", state, classifyErr)
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
