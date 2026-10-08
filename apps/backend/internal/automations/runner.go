package automations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	gitutil "github.com/orchestra/orchestra/apps/backend/internal/utils/git"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
	"github.com/orchestra/orchestra/apps/backend/internal/worktreejobs"
)

// ChatEngine is the subset of *workspacechat.Service used by runs.
type ChatEngine interface {
	CreateWithRequest(ctx context.Context, pid string, req workspacechat.CreateRequest) (workspacechat.Session, error)
	Send(ctx context.Context, pid, id string, req workspacechat.SendRequest) (workspacechat.Accepted, error)
	Detail(ctx context.Context, pid, id string) (workspacechat.Detail, error)
	Stop(ctx context.Context, pid, id string) (workspacechat.Session, error)
	Reply(ctx context.Context, pid, id, requestID string, req workspacechat.ReplyRequest) (workspacechat.RuntimeRequest, error)
}

// WorktreeCreator is the subset of *worktreejobs.Service used by new_worktree runs.
type WorktreeCreator interface {
	Submit(ctx context.Context, projectID string, req worktreejobs.Request) (worktreejobs.Job, error)
	Get(ctx context.Context, pid, rid string) (worktreejobs.Job, error)
}

const unattendedAnswer = "This is an unattended scheduled automation run; no human is available to answer. Continue without this input or stop."

// denialAnswer builds the reply that refuses a native runtime request. ok is
// false when the method has no accepted denial shape.
func denialAnswer(r workspacechat.RuntimeRequest) (json.RawMessage, bool) {
	switch r.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		return json.RawMessage(`{"decision":"decline"}`), true
	case "item/tool/requestUserInput":
		var p struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		}
		if json.Unmarshal(r.Params, &p) != nil || len(p.Questions) == 0 {
			return nil, false
		}
		answers := map[string]map[string][]string{}
		for _, q := range p.Questions {
			answers[q.ID] = map[string][]string{"answers": {unattendedAnswer}}
		}
		raw, err := json.Marshal(map[string]any{"answers": answers})
		return raw, err == nil
	}
	return nil, false
}

func slug(name string, max int) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(name) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
		if b.Len() >= max {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "automation"
	}
	return out
}

func gitRefExists(ctx context.Context, root, ref string) bool {
	cmd := backgroundcommand.CommandContext(ctx, "git", "rev-parse", "--verify", "--quiet", "--end-of-options", ref+"^{commit}")
	cmd.Dir = root
	return cmd.Run() == nil
}

// defaultBaseRef resolves the base for a new worktree: the configured
// branch, else the project's default branch, preferring a local ref, then
// origin/<branch>; an empty configuration falls back to HEAD.
func defaultBaseRef(ctx context.Context, root, branch string) string {
	explicit := branch != ""
	if !explicit {
		branch = gitutil.DefaultBranch(ctx, root)
	}
	for _, cand := range []string{branch, "origin/" + branch} {
		if gitRefExists(ctx, root, cand) {
			return cand
		}
	}
	if explicit {
		return branch
	}
	return "HEAD"
}

func (s *Service) buildPrompt(ctx context.Context, a Automation) string {
	if a.TaskID == "" {
		return a.Prompt
	}
	t, err := s.opts.LookupTask(ctx, a.TaskID)
	if err != nil {
		return fmt.Sprintf("Linked task id: %s (task details are unavailable).\n\n---\n\n%s", a.TaskID, a.Prompt)
	}
	header := fmt.Sprintf("Linked task %s: %s\n\n", t.Identifier, t.Title)
	footer := "\n\n---\n\n" + a.Prompt
	desc := strings.TrimSpace(t.Description)
	budget := 60*1024 - len(header) - len(footer)
	if budget < 0 {
		budget = 0
	}
	if len(desc) > budget {
		desc = desc[:budget]
		for !utf8.ValidString(desc) && len(desc) > 0 {
			desc = desc[:len(desc)-1]
		}
		desc += "\n[description truncated]"
	}
	if desc == "" {
		desc = "(no description)"
	}
	return header + desc + footer
}

func truncateOutput(v string) (string, bool) {
	if len(v) <= MaxOutputBytes {
		return v, false
	}
	v = v[:MaxOutputBytes]
	for !utf8.ValidString(v) && len(v) > 0 {
		v = v[:len(v)-1]
	}
	return v, true
}

// sleepOrDone waits d or until ctx is done; it reports whether ctx is done.
func sleepOrDone(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return true
	case <-t.C:
		return false
	}
}

func (s *Service) createWorktree(ctx context.Context, a Automation, run Run, project db.Project) (*worktreejobs.Job, error) {
	s.mu.Lock()
	creator := s.worktrees
	s.mu.Unlock()
	if creator == nil {
		return nil, errors.New("worktree creation is unavailable")
	}
	loc := time.Local
	if c, err := Compile(a.Schedule); err == nil {
		loc = c.Location
	}
	when := parseStamp(run.StartedAt)
	if when.IsZero() {
		when = s.now()
	}
	name := "auto-" + slug(a.Name, 40) + "-" + when.In(loc).Format("20060102T1504")
	base := s.opts.ResolveBaseRef(ctx, project.RootPath, a.BaseBranch)
	for attempt := 0; attempt < 2; attempt++ {
		candidate := name
		if attempt == 1 {
			candidate = name + "-" + itoa(run.RunNumber)
		}
		job, err := creator.Submit(ctx, project.ID, worktreejobs.Request{RequestID: uuid.NewString(), Name: candidate, Branch: candidate, BaseRef: base})
		if err != nil {
			return nil, err
		}
		deadline := time.Now().Add(3 * time.Minute)
		for job.Status != "completed" && job.Status != "failed" && job.Status != "unknown" {
			if time.Now().After(deadline) {
				return nil, errors.New("worktree creation did not finish within 3 minutes")
			}
			if sleepOrDone(ctx, minDuration(s.opts.PollInterval, 500*time.Millisecond)) {
				return nil, ctx.Err()
			}
			if job, err = creator.Get(context.Background(), project.ID, job.RequestID); err != nil {
				return nil, err
			}
		}
		if job.Status == "completed" && job.Workspace != nil {
			return &job, nil
		}
		if attempt == 0 && job.Status == "failed" && strings.Contains(job.Message, "already exists") {
			continue
		}
		return nil, errors.New(job.Message)
	}
	return nil, errors.New("worktree name is already in use")
}

func minDuration(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}

func chatErrorStatus(err error) string {
	if errors.Is(err, workspacechat.ErrUnsupported) || errors.Is(err, workspacechat.ErrForbidden) || errors.Is(err, workspacechat.ErrNotFound) {
		return StatusSkippedUnavailable
	}
	return StatusFailed
}

// executeChat runs one automation turn through the workspace chat engine.
func (s *Service) executeChat(ctx context.Context, a Automation, run Run, progress func(Run)) Run {
	finish := func(status, note string) Run {
		run.Status = status
		if note != "" {
			run.Error = appendNote(run.Error, note)
		}
		return run
	}
	if s.opts.Chat == nil {
		return finish(StatusSkippedUnavailable, "Unavailable: the workspace chat engine is not configured.")
	}
	run.Status = StatusStarting
	run.StartedAt = stampTime(s.now())
	progress(run)

	chatPID := workspacechat.OrchestratorScope
	callCtx := context.Background()
	if a.ProjectID != "" {
		project, err := s.db.GetProjectByID(context.Background(), a.ProjectID)
		if err != nil {
			return finish(StatusSkippedUnavailable, "Unavailable: the linked project no longer exists.")
		}
		chatPID = project.ID
		run.ProjectID = project.ID
		run.WorkspacePath = project.RootPath
		if a.WorkspaceMode == WorkspaceNewWorktree {
			job, err := s.createWorktree(ctx, a, run, project)
			if err != nil {
				if ctx.Err() != nil && s.cancelRequested(run.ID) {
					return finish(StatusCancelled, "Cancelled before the agent turn was sent.")
				}
				return finish(StatusFailed, "Worktree creation failed: "+err.Error())
			}
			run.WorkspaceID = job.Workspace.ID
			run.WorkspacePath = job.Workspace.Path
			run.Branch = job.Workspace.Branch
			callCtx = workspacechat.WithWorkspaceID(callCtx, run.WorkspaceID)
			progress(run)
		}
	}
	if ctx.Err() != nil {
		if s.cancelRequested(run.ID) {
			return finish(StatusCancelled, "Cancelled before the agent turn was sent.")
		}
		return run
	}
	title := run.Title
	if utf8.RuneCountInString(title) > 200 {
		title = string([]rune(title)[:200])
	}
	// Model and effort travel with the message, as in interactive chat:
	// creation-time options are only accepted by native-session harnesses.
	sess, err := s.opts.Chat.CreateWithRequest(callCtx, chatPID, workspacechat.CreateRequest{Provider: a.Provider, Title: title})
	if err != nil {
		return finish(chatErrorStatus(err), "Could not open a conversation: "+err.Error())
	}
	run.ChatProjectID, run.ChatSessionID = chatPID, sess.ID
	if run.WorkspaceID == "" {
		run.WorkspaceID = sess.WorkspaceID
	}
	if sess.WorkspacePath != "" {
		run.WorkspacePath = sess.WorkspacePath
	}
	prompt := s.buildPrompt(context.Background(), a)
	if _, err = s.opts.Chat.Send(workspacechat.WithTurnTimeout(callCtx, s.opts.TurnTimeout), chatPID, sess.ID, workspacechat.SendRequest{ClientMessageID: run.ID, Text: prompt, RequestedModel: a.Model, RequestedReasoningEffort: a.ReasoningEffort, RequestedAgentID: a.AgentID}); err != nil {
		if errors.Is(err, workspacechat.ErrBusy) {
			return finish(StatusFailed, "The checkout is busy with another conversation turn; the prompt was not sent.")
		}
		return finish(chatErrorStatus(err), "Could not send the prompt: "+err.Error())
	}
	run.Status = StatusRunning
	progress(run)
	return s.awaitTurn(ctx, callCtx, chatPID, sess.ID, run, progress)
}

func (s *Service) awaitTurn(ctx, callCtx context.Context, chatPID, sessionID string, run Run, progress func(Run)) Run {
	handled := map[string]bool{}
	done := ctx.Done()
	stopRequested := false
	deadline := time.Now().Add(s.opts.TurnTimeout + 2*time.Minute)
	failures := 0
	var d workspacechat.Detail
	for {
		var err error
		d, err = s.opts.Chat.Detail(callCtx, chatPID, sessionID)
		if err != nil {
			failures++
			if failures >= 10 {
				run.Status = StatusFailed
				run.Error = appendNote(run.Error, "Lost track of the conversation: "+err.Error())
				return run
			}
		} else {
			failures = 0
			if s.handleRequests(callCtx, chatPID, sessionID, d, handled, &run) {
				progress(run)
			}
			if d.Session.Status != "running" && d.Session.Status != "stopping" {
				break
			}
		}
		if !stopRequested && time.Now().After(deadline) {
			stopRequested = true
			run.Error = appendNote(run.Error, "Run exceeded its turn timeout; stop requested.")
			_, _ = s.opts.Chat.Stop(callCtx, chatPID, sessionID)
		}
		select {
		case <-done:
			done = nil
			if s.isClosing() && !s.cancelRequested(run.ID) {
				return run
			}
			if !stopRequested {
				stopRequested = true
				_, _ = s.opts.Chat.Stop(callCtx, chatPID, sessionID)
			}
		case <-time.After(s.opts.PollInterval):
		}
	}
	return s.settle(run, d)
}

// handleRequests auto-denies pending native requests. It reports whether the
// run changed.
func (s *Service) handleRequests(callCtx context.Context, chatPID, sessionID string, d workspacechat.Detail, handled map[string]bool, run *Run) bool {
	changed := false
	for _, r := range d.Requests {
		if r.Status != "pending" || handled[r.ID] {
			continue
		}
		handled[r.ID] = true
		changed = true
		answer, ok := denialAnswer(r)
		if !ok {
			run.Error = appendNote(run.Error, "Runtime request could not be auto-denied: "+r.Method+"; turn stopped.")
			_, _ = s.opts.Chat.Stop(callCtx, chatPID, sessionID)
			continue
		}
		_, err := s.opts.Chat.Reply(callCtx, chatPID, sessionID, r.ID, workspacechat.ReplyRequest{ClientResponseID: "automation-deny-" + uuid.NewString(), Answer: answer})
		note := "Approval request auto-denied: " + r.Method
		if err != nil {
			note += " (reply failed: " + err.Error() + ")"
		}
		run.Error = appendNote(run.Error, note)
	}
	return changed
}

// settle maps the settled conversation to a terminal run.
func (s *Service) settle(run Run, d workspacechat.Detail) Run {
	for i := len(d.Messages) - 1; i >= 0; i-- {
		if d.Messages[i].Role == "assistant" {
			run.Output, run.OutputTruncated = truncateOutput(d.Messages[i].Text)
			break
		}
	}
	for i := len(d.Events) - 1; i >= 0; i-- {
		if u := d.Events[i].Usage; u != nil {
			t := u.Total
			if t.TotalTokens == 0 && t.InputTokens == 0 && t.OutputTokens == 0 {
				t = u.Last
			}
			total := t.TotalTokens
			if total == 0 {
				total = t.InputTokens + t.OutputTokens
			}
			run.Usage = Usage{InputTokens: t.InputTokens, OutputTokens: t.OutputTokens, TotalTokens: total}
			break
		}
	}
	if d.Session.EffectiveModel != "" {
		run.Model = d.Session.EffectiveModel
	}
	switch d.Session.Status {
	case "idle":
		run.Status = StatusSucceeded
	case "interrupted":
		if s.cancelRequested(run.ID) {
			run.Status = StatusCancelled
		} else {
			run.Status = StatusFailed
			run.Error = appendNote(run.Error, nonEmpty(d.Session.Error, "Turn interrupted."))
		}
	default:
		run.Status = StatusFailed
		run.Error = appendNote(run.Error, nonEmpty(d.Session.Error, "Agent turn failed."))
	}
	return run
}

func nonEmpty(v, fallback string) string {
	if strings.TrimSpace(v) == "" {
		return fallback
	}
	return v
}
