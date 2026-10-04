// ade-fixture produces simulated-provider evidence with actual local Git and
// verification effects. It never treats its result as application E2E coverage.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/ade"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/evidence"
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	flags := flag.NewFlagSet("ade-fixture", flag.ContinueOnError)
	sourceRoot := flags.String("source-root", ".", "Orchestra repository root (read-only source fingerprint)")
	outputDir := flags.String("output-dir", "", "new evidence directory outside the repository; default unique temporary directory")
	broken := flags.Bool("broken", false, "deliberately produce a failing real check and failed report")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	root, err := filepath.Abs(*sourceRoot)
	if err != nil {
		return err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(filepath.Join(root, ".git")); err != nil {
		return fmt.Errorf("--source-root must be the repository root containing .git: %w", err)
	}
	source, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		return err
	}
	// The execution fixture also uses the system temp parent; reject a temp
	// override that would make test mutations part of the production checkout.
	tempParent, err := filepath.EvalSymlinks(os.TempDir())
	if err != nil {
		return err
	}
	if inside(root, tempParent) {
		return fmt.Errorf("system temporary directory must be outside source repository")
	}
	if *outputDir == "" {
		*outputDir, err = os.MkdirTemp("", "orchestra-ade-evidence-")
	} else {
		*outputDir, err = filepath.Abs(*outputDir)
		if err != nil {
			return err
		}
		parent, e := filepath.EvalSymlinks(filepath.Dir(*outputDir))
		if e != nil {
			return e
		}
		resolved := filepath.Join(parent, filepath.Base(*outputDir))
		if inside(root, resolved) {
			return fmt.Errorf("evidence output must be outside source repository")
		}
		*outputDir = resolved
		err = os.Mkdir(*outputDir, 0700)
	}
	if err != nil {
		return err
	}
	f, err := ade.NewFixture(ctx)
	if err != nil {
		return fmt.Errorf("provision fixture: %w (diagnostics directory %s)", err, *outputDir)
	}
	defer f.Close()
	gitVersion, err := f.Command(ctx, f.Manifest.Root, "git", "--version")
	if err != nil {
		return err
	}
	report := evidence.Report{Version: 1, Source: source, FixtureID: f.Manifest.ID, Environment: evidence.Environment{OS: runtime.GOOS, Arch: runtime.GOARCH, RuntimeVersions: map[string]string{"go": runtime.Version(), "git": strings.TrimSpace(gitVersion)}, Provider: "recording_runner", ProviderVersion: "fixture-v1", Model: "deterministic", Tracker: "none", RuntimeTarget: "local"}, OverallStatus: "passed"}
	var artifactErr error
	write := func(name string, value any) {
		if artifactErr != nil {
			return
		}
		var data []byte
		switch v := value.(type) {
		case string:
			data = []byte(v)
		default:
			data, artifactErr = json.MarshalIndent(v, "", "  ")
		}
		if artifactErr == nil {
			artifactErr = os.WriteFile(filepath.Join(*outputDir, name), data, 0600)
		}
	}
	write("ownership.json", f.Manifest)
	scenario := func(id string, boundaries, artifacts []string, check func() error) {
		start := time.Now()
		e := check()
		row := evidence.Scenario{ID: id, Status: "passed", Mode: "simulated", Boundaries: boundaries, Artifacts: artifacts, DurationMS: time.Since(start).Milliseconds()}
		if e != nil {
			row.Status = "failed"
			row.Reason = e.Error()
			report.OverallStatus = "failed"
		}
		report.Scenarios = append(report.Scenarios, row)
	}
	scenario("fixture.real_change_and_check", []string{"recording_runner", "filesystem", "git", "check_subprocess"}, []string{"baseline-check.txt", "turn.json", "events.json", "git-status.json"}, func() error {
		checkCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		defer cancel()
		baseline, e := f.Command(checkCtx, f.Manifest.Worktree, "go", "test", "./...")
		write("baseline-check.txt", baseline)
		if e == nil {
			return fmt.Errorf("broken baseline check unexpectedly passed")
		}
		if !strings.Contains(baseline, "got 0; want 42") {
			return fmt.Errorf("baseline did not execute the expected failing assertion: %w\n%s", e, baseline)
		}
		answer := 42
		if *broken {
			answer = 41
		}
		runner := ade.NewRecordingRunner(f, ade.Step{WritePath: "answer.go", WriteContent: fmt.Sprintf("package fixture\n\nfunc Answer() int { return %d }\n", answer)}, ade.Step{Check: true}, ade.Step{Event: &agents.Event{Kind: "turn_completed", Message: "verified"}})
		req := agents.TurnRequest{SessionID: "fixture-session-1", Workspace: f.Manifest.Worktree, WorkspaceRoot: filepath.Dir(f.Manifest.Worktree), Prompt: "Implement Answer returning 42, then run verification", IssueIdentifier: "ADE-FIXTURE-1", Attempt: 1, RuntimeTarget: agents.RuntimeLocal}
		registry := agents.NewRegistry(nil)
		registry.SetRunner("ADE_FIXTURE", runner)
		var events []agents.Event
		result, turnErr := registry.RunTurn(checkCtx, "ADE_FIXTURE", req, func(event agents.Event) { events = append(events, event) })
		calls := runner.Invocations()
		write("turn.json", map[string]any{"request": map[string]any{"session_id": req.SessionID, "workspace": req.Workspace, "workspace_root": req.WorkspaceRoot, "prompt": req.Prompt, "issue_identifier": req.IssueIdentifier, "attempt": req.Attempt, "timeout_ns": req.Timeout, "command_override": req.CommandOverride, "auto_approve": req.AutoApprove, "tool_executor_present": req.ToolExecutor != nil, "tool_specs": req.ToolSpecs, "resource_specs": req.ResourceSpecs, "runtime_target": req.RuntimeTarget}, "result": result, "check_output": calls[0].CheckOutput, "error": calls[0].Error})
		write("events.json", events)
		seed, e := f.Git(checkCtx, f.Manifest.Repository, "status", "--porcelain")
		if e != nil {
			return e
		}
		task, e := f.Git(checkCtx, f.Manifest.Worktree, "status", "--porcelain")
		if e != nil {
			return e
		}
		remote, e := f.Git(checkCtx, f.Manifest.Root, "--git-dir", f.Manifest.Remote, "show", "main:answer.go")
		if e != nil {
			return e
		}
		write("git-status.json", map[string]string{"seed": seed, "task": task, "remote_answer": remote})
		if seed != "" || !strings.Contains(task, "answer.go") || !strings.Contains(remote, "return 0") {
			return fmt.Errorf("Git effects disagree with task-only edit")
		}
		if turnErr != nil {
			return fmt.Errorf("actual task verification failed: %w", turnErr)
		}
		if len(events) != 1 || events[0].Kind != "turn_completed" || result.ExitCode != 0 {
			return fmt.Errorf("provider outcome disagrees with check")
		}
		return nil
	})
	scenario("fixture.environment_isolation", []string{"filesystem", "git", "child_environment"}, []string{"environment.json", "isolated-git-config.txt"}, func() error {
		values := map[string]string{}
		for _, entry := range f.Env() {
			k, v, _ := strings.Cut(entry, "=")
			values[k] = v
		}
		write("environment.json", values)
		if values["HOME"] != f.Manifest.Home || values["USERPROFILE"] != f.Manifest.Home {
			return fmt.Errorf("home directories are not isolated")
		}
		for _, key := range []string{"GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GIT_DIR", "GIT_CONFIG_COUNT"} {
			if _, ok := values[key]; ok {
				return fmt.Errorf("inherited credential or Git override %s", key)
			}
		}
		if _, e := f.Git(ctx, f.Manifest.Root, "config", "--global", "ade.fixture", f.Manifest.ID); e != nil {
			return e
		}
		config, e := os.ReadFile(filepath.Join(f.Manifest.Home, ".gitconfig"))
		if e != nil {
			return e
		}
		write("isolated-git-config.txt", string(config))
		if !strings.Contains(string(config), f.Manifest.ID) {
			return fmt.Errorf("child Git configuration not written to isolated home")
		}
		return nil
	})
	scenario("fixture.cancelled_dispatch", []string{"recording_runner", "filesystem"}, []string{"cancellation.json"}, func() error {
		cancelCtx, cancel := context.WithTimeout(ctx, 20*time.Millisecond)
		defer cancel()
		runner := ade.NewRecordingRunner(f, ade.Step{Delay: time.Second}, ade.Step{WritePath: "late.txt", WriteContent: "late"}, ade.Step{Event: &agents.Event{Kind: "turn_completed"}})
		var events int
		result, e := runner.RunTurn(cancelCtx, agents.TurnRequest{Workspace: f.Manifest.Worktree, SessionID: "cancel-session"}, func(agents.Event) { events++ })
		write("cancellation.json", map[string]any{"error": fmt.Sprint(e), "result": result, "event_count": events})
		if !errors.Is(e, context.DeadlineExceeded) || events != 0 || result.ExitCode == 0 {
			return fmt.Errorf("cancellation did not suppress completion")
		}
		if _, e := os.Stat(filepath.Join(f.Manifest.Worktree, "late.txt")); !os.IsNotExist(e) {
			return fmt.Errorf("cancelled turn wrote late file")
		}
		return nil
	})
	scenario("fixture.failed_dispatch", []string{"recording_runner"}, []string{"injected-failure.json"}, func() error {
		failure := errors.New("deliberate provider failure")
		runner := ade.NewRecordingRunner(f, ade.Step{Failure: failure}, ade.Step{Event: &agents.Event{Kind: "turn_completed"}})
		var events int
		result, e := runner.RunTurn(ctx, agents.TurnRequest{Workspace: f.Manifest.Worktree}, func(agents.Event) { events++ })
		write("injected-failure.json", map[string]any{"error": fmt.Sprint(e), "result": result, "event_count": events})
		if !errors.Is(e, failure) || events != 0 || runner.Invocations()[0].Error != failure.Error() {
			return fmt.Errorf("injected failure was not preserved")
		}
		return nil
	})
	scenario("fixture.cleanup_ownership", []string{"filesystem"}, []string{"cleanup.json", "ownership.json"}, func() error {
		manifest := filepath.Join(f.Manifest.Root, "ownership.json")
		original, e := os.ReadFile(manifest)
		if e != nil {
			return e
		}
		if e := os.WriteFile(manifest, []byte("{}"), 0600); e != nil {
			return e
		}
		refusal := f.Close()
		restoreErr := os.WriteFile(manifest, original, 0600)
		if restoreErr != nil {
			return restoreErr
		}
		if refusal == nil {
			return fmt.Errorf("cleanup accepted ownership mismatch")
		}
		if e := f.Close(); e != nil {
			return e
		}
		_, statErr := os.Stat(f.Manifest.Root)
		write("cleanup.json", map[string]any{"mismatch_refusal": refusal.Error(), "root_removed": os.IsNotExist(statErr)})
		if !os.IsNotExist(statErr) {
			return fmt.Errorf("fixture root remains after cleanup")
		}
		return nil
	})
	if artifactErr != nil {
		return fmt.Errorf("persist fixture artifacts: %w", artifactErr)
	}
	current, err := evidence.Fingerprint(ctx, root)
	if err != nil {
		return err
	}
	if current != source {
		report.OverallStatus = "failed"
		report.Scenarios = append(report.Scenarios, evidence.Scenario{ID: "fixture.source_stability", Status: "failed", Mode: "simulated", Boundaries: []string{"source_tree"}, Artifacts: []string{}, Reason: "source tree changed while evidence was produced"})
	}
	report.GeneratedAt = time.Now().UTC()
	write("report.json", report)
	if artifactErr != nil {
		return artifactErr
	}
	fmt.Fprintln(stdout, filepath.Join(*outputDir, "report.json"))
	if report.OverallStatus != "passed" {
		return fmt.Errorf("fixture failed; persisted report and artifacts at %s", *outputDir)
	}
	return nil
}

func inside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}
