package evidence_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/ade"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/evidence"
)

func schema(t *testing.T) []byte {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	data, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", "packages", "protocol", "schemas", "ade", "evidence.v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func sample() (evidence.Report, evidence.Expectations) {
	now := time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)
	r := evidence.Report{
		Version: 1, Source: evidence.Source{Revision: strings.Repeat("a", 40), TreeFingerprint: strings.Repeat("b", 64)},
		Environment: evidence.Environment{OS: "windows", Arch: "amd64", RuntimeVersions: map[string]string{"go": "go1.26.7"}, Provider: "recording", ProviderVersion: "fixture-v1", Model: "deterministic", Tracker: "none", RuntimeTarget: "local"},
		FixtureID:   "isolated-test", GeneratedAt: now, OverallStatus: "passed",
		Scenarios: []evidence.Scenario{{ID: "fixture.change", Status: "passed", Mode: "simulated", Boundaries: []string{"git", "filesystem", "check"}, Artifacts: []string{}, DurationMS: 10}},
	}
	e := evidence.Expectations{Source: r.Source, Environment: r.Environment, Now: now, Scenarios: []evidence.Requirement{{ID: "fixture.change", Mode: "simulated", Boundaries: []string{"git", "check"}}}}
	return r, e
}

func encoded(t *testing.T, r evidence.Report) []byte {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestSchemaPreservesFailureAndRejectsMissingOrMisleadingEvidence(t *testing.T) {
	for _, status := range []string{"passed", "failed", "blocked", "skipped", "unsupported"} {
		t.Run(status, func(t *testing.T) {
			r, _ := sample()
			r.OverallStatus, r.Scenarios[0].Status = status, status
			if status != "passed" {
				r.Scenarios[0].Reason = "observed prerequisite or failure"
			}
			if _, err := evidence.Decode(schema(t), encoded(t, r)); err != nil {
				t.Fatal(err)
			}
		})
	}
	cases := map[string]func(*evidence.Report){
		"duplicate":           func(r *evidence.Report) { r.Scenarios = append(r.Scenarios, r.Scenarios[0]) },
		"false-pass":          func(r *evidence.Report) { r.Scenarios[0].Status = "failed"; r.Scenarios[0].Reason = "check failed" },
		"false-fail":          func(r *evidence.Report) { r.OverallStatus = "failed" },
		"no-reason":           func(r *evidence.Report) { r.OverallStatus = "blocked"; r.Scenarios[0].Status = "blocked" },
		"no-scenarios":        func(r *evidence.Report) { r.Scenarios = []evidence.Scenario{} },
		"bad-mode":            func(r *evidence.Report) { r.Scenarios[0].Mode = "mock-as-real" },
		"unknown-boundary":    func(r *evidence.Report) { r.Scenarios[0].Boundaries = []string{} },
		"negative-duration":   func(r *evidence.Report) { r.Scenarios[0].DurationMS = -1 },
		"missing-runtime":     func(r *evidence.Report) { r.Environment.RuntimeVersions = map[string]string{} },
		"missing-fingerprint": func(r *evidence.Report) { r.Source.TreeFingerprint = "" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r, _ := sample()
			change(&r)
			if _, err := evidence.Decode(schema(t), encoded(t, r)); err == nil {
				t.Fatal("invalid evidence accepted")
			}
		})
	}
	r, _ := sample()
	data := encoded(t, r)
	data = append(data[:len(data)-1], []byte(",\"invented_pass\":true}")...)
	if _, err := evidence.Decode(schema(t), data); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := evidence.Decode(schema(t), []byte("not JSON")); err == nil {
		t.Fatal("malformed JSON accepted")
	}
}

func TestAcceptanceRequiresIndependentScopeSourceAndCompleteScenarioSet(t *testing.T) {
	r, e := sample()
	decoded, err := evidence.Decode(schema(t), encoded(t, r))
	if err != nil {
		t.Fatal(err)
	}
	if err := evidence.Check(decoded, e); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*evidence.Report, *evidence.Expectations){
		"absent-scenario":     func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios[0].ID = "lifecycle.execute" },
		"simulation-not-real": func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios[0].Mode = "real" },
		"missing-boundary":    func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios[0].Boundaries = []string{"electron"} },
		"different-tree":      func(r *evidence.Report, _ *evidence.Expectations) { r.Source.TreeFingerprint = strings.Repeat("c", 64) },
		"different-revision":  func(r *evidence.Report, _ *evidence.Expectations) { r.Source.Revision = strings.Repeat("c", 40) },
		"stale":               func(r *evidence.Report, e *evidence.Expectations) { r.GeneratedAt = e.Now.Add(-25 * time.Hour) },
		"future":              func(r *evidence.Report, e *evidence.Expectations) { r.GeneratedAt = e.Now.Add(2 * time.Minute) },
		"other-platform":      func(r *evidence.Report, _ *evidence.Expectations) { r.Environment.OS = "linux" },
		"other-model":         func(r *evidence.Report, _ *evidence.Expectations) { r.Environment.Model = "other" },
		"other-runtime-version": func(r *evidence.Report, _ *evidence.Expectations) {
			r.Environment.RuntimeVersions = map[string]string{"go": "other"}
		},
		"empty-profile":           func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios = nil },
		"ambiguous-profile":       func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios = append(e.Scenarios, e.Scenarios[0]) },
		"unknown-mode":            func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios[0].Mode = "unknown" },
		"incomplete-source":       func(_ *evidence.Report, e *evidence.Expectations) { e.Source.TreeFingerprint = "" },
		"missing-clock":           func(_ *evidence.Report, e *evidence.Expectations) { e.Now = time.Time{} },
		"incomplete-environment":  func(_ *evidence.Report, e *evidence.Expectations) { e.Environment.ProviderVersion = "" },
		"missing-runtime-profile": func(_ *evidence.Report, e *evidence.Expectations) { e.Environment.RuntimeVersions = nil },
		"missing-artifacts":       func(_ *evidence.Report, e *evidence.Expectations) { e.Scenarios[0].MinArtifacts = 1 },
		"nonpass":                 func(r *evidence.Report, _ *evidence.Expectations) { r.OverallStatus = "blocked" },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			r, e := sample()
			change(&r, &e)
			if err := evidence.Check(r, e); err == nil {
				t.Fatal("invalid acceptance passed")
			}
		})
	}
}

func TestArtifactsMustExistInsideReportDirectory(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "trace.txt"), []byte("fixture trace"), 0600); err != nil {
		t.Fatal(err)
	}
	r, _ := sample()
	r.Scenarios[0].Artifacts = []string{"trace.txt"}
	if err := evidence.CheckArtifacts(root, r); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"missing.txt", "..", root, "."} {
		r.Scenarios[0].Artifacts = []string{invalid}
		if err := evidence.CheckArtifacts(root, r); err == nil {
			t.Fatalf("invalid artifact %q accepted", invalid)
		}
	}
}

func TestFingerprintIncludesDirtyAndUntrackedSourceButNotIgnoredOutputs(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	f, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := f.Close(); err != nil {
			t.Error(err)
		}
	})
	root := f.Manifest.Repository
	before, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	write := func(name, contents string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("answer.go", "package fixture\nfunc Answer() int { return 42 }\n")
	dirty, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if before.Revision != dirty.Revision || before.TreeFingerprint == dirty.TreeFingerprint {
		t.Fatal("dirty change not identified independently of revision")
	}
	write("new-source.txt", "new source")
	untracked, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if dirty.TreeFingerprint == untracked.TreeFingerprint {
		t.Fatal("untracked source omitted")
	}
	write(".gitignore", "output.log\n")
	ignoredBefore, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	write("output.log", "generated output")
	ignoredAfter, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if ignoredBefore != ignoredAfter {
		t.Fatal("ignored output changes source identity")
	}
	if err := os.Remove(filepath.Join(root, "answer.go")); err != nil {
		t.Fatal(err)
	}
	deleted, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	if deleted.TreeFingerprint == ignoredAfter.TreeFingerprint {
		t.Fatal("tracked deletion omitted")
	}
}
