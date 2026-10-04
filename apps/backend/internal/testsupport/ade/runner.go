package ade

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

type Step struct {
	Delay time.Duration
	Event *agents.Event
	// WritePath is relative to the task worktree; WriteContent is literal.
	WritePath    string
	WriteContent string
	Tool         string
	Arguments    map[string]any
	Check        bool // Runs the fixture's real go test ./... command.
	Failure      error
}

type Invocation struct {
	Request     agents.TurnRequest
	CheckOutput string
	Result      agents.TurnResult
	Error       string
}

// RecordingRunner uses production Runner/TurnRequest boundaries. It simulates
// provider delivery only; filesystem edits and verification commands are real.
type RecordingRunner struct {
	fixture *Fixture
	steps   []Step
	mu      sync.Mutex
	calls   []Invocation
}

func NewRecordingRunner(f *Fixture, steps ...Step) *RecordingRunner {
	copySteps := append([]Step(nil), steps...)
	for i := range copySteps {
		copySteps[i].Arguments = cloneMap(copySteps[i].Arguments)
		if e := copySteps[i].Event; e != nil {
			v := *e
			v.Raw = cloneMap(e.Raw)
			copySteps[i].Event = &v
		}
	}
	return &RecordingRunner{fixture: f, steps: copySteps}
}

func cloneMap(m map[string]any) map[string]any {
	if m == nil {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = cloneValue(v)
	}
	return out
}
func cloneValue(v any) any {
	switch x := v.(type) {
	case map[string]any:
		return cloneMap(x)
	case []any:
		out := make([]any, len(x))
		for i, v := range x {
			out[i] = cloneValue(v)
		}
		return out
	default:
		// Preserve typed JSON arrays (for example []string schema enums).
		value := reflect.ValueOf(v)
		if value.IsValid() && value.Kind() == reflect.Slice {
			if value.IsNil() {
				return v
			}
			out := reflect.MakeSlice(value.Type(), value.Len(), value.Len())
			for i := 0; i < value.Len(); i++ {
				cloned := cloneValue(value.Index(i).Interface())
				if cloned == nil {
					out.Index(i).Set(reflect.Zero(value.Type().Elem()))
				} else {
					out.Index(i).Set(reflect.ValueOf(cloned))
				}
			}
			return out.Interface()
		}
		return v
	}
}
func cloneRequest(req agents.TurnRequest) agents.TurnRequest {
	cloneSpecs := func(in []map[string]any) []map[string]any {
		if in == nil {
			return nil
		}
		out := make([]map[string]any, len(in))
		for i, v := range in {
			out[i] = cloneMap(v)
		}
		return out
	}
	req.ToolSpecs = cloneSpecs(req.ToolSpecs)
	req.ResourceSpecs = cloneSpecs(req.ResourceSpecs)
	return req
}

func (r *RecordingRunner) Invocations() []Invocation {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := append([]Invocation(nil), r.calls...)
	for i := range out {
		out[i].Request = cloneRequest(out[i].Request)
	}
	return out
}

func (r *RecordingRunner) RunTurn(ctx context.Context, req agents.TurnRequest, onEvent agents.EventHandler) (result agents.TurnResult, err error) {
	result = agents.TurnResult{Provider: agents.Provider("ADE_FIXTURE"), SessionID: req.SessionID}
	r.mu.Lock()
	index := len(r.calls)
	r.calls = append(r.calls, Invocation{Request: cloneRequest(req)})
	r.mu.Unlock()
	var checkOutput string
	defer func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		r.calls[index].Result = result
		r.calls[index].CheckOutput = checkOutput
		if err != nil {
			r.calls[index].Error = err.Error()
		}
	}()
	fail := func(e error) (agents.TurnResult, error) { result.ExitCode = 1; return result, e }
	if filepath.Clean(req.Workspace) != filepath.Clean(r.fixture.owned.Worktree) {
		return fail(fmt.Errorf("request workspace is not this fixture's task worktree"))
	}
	if err := r.fixture.CheckOwned(req.Workspace); err != nil {
		return fail(err)
	}
	if req.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, req.Timeout)
		defer cancel()
	}
	for _, step := range r.steps {
		if err := ctx.Err(); err != nil {
			return fail(err)
		}
		if step.Delay > 0 {
			timer := time.NewTimer(step.Delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return fail(ctx.Err())
			case <-timer.C:
			}
		}
		if err := ctx.Err(); err != nil {
			return fail(err)
		}
		if step.Failure != nil {
			return fail(step.Failure)
		}
		if step.WritePath != "" {
			if err := r.write(step.WritePath, step.WriteContent); err != nil {
				return fail(err)
			}
		}
		if step.Tool != "" {
			if req.ToolExecutor == nil {
				return fail(fmt.Errorf("script requires tool executor: %s", step.Tool))
			}
			response := req.ToolExecutor(ctx, step.Tool, cloneMap(step.Arguments))
			if onEvent != nil {
				onEvent(agents.Event{Provider: result.Provider, SessionID: req.SessionID, Kind: "tool_result", Raw: cloneMap(response), Timestamp: time.Now().UTC()})
			}
		}
		if step.Check {
			output, e := r.fixture.Command(ctx, req.Workspace, "go", "test", "./...")
			checkOutput += output
			if e != nil {
				return fail(e)
			}
		}
		if step.Event != nil {
			event := *step.Event
			event.Raw = cloneMap(event.Raw)
			if event.Provider == "" {
				event.Provider = result.Provider
			}
			if event.SessionID == "" {
				event.SessionID = req.SessionID
			}
			if event.Timestamp.IsZero() {
				event.Timestamp = time.Now().UTC()
			}
			result.Usage = event.Usage
			result.Output += event.Message
			if onEvent != nil {
				onEvent(event)
			}
		}
	}
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	return result, nil
}

func (r *RecordingRunner) write(name, content string) error {
	if filepath.IsAbs(name) || filepath.VolumeName(name) != "" {
		return fmt.Errorf("write path must be relative")
	}
	clean := filepath.Clean(name)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".git" || strings.HasPrefix(clean, ".git"+string(filepath.Separator)) {
		return fmt.Errorf("unsafe fixture write path")
	}
	path := filepath.Join(r.fixture.owned.Worktree, clean)
	// Resolve the nearest existing ancestor before creating directories, so a
	// symlink cannot redirect MkdirAll or WriteFile outside the owned tree.
	ancestor := path
	for {
		_, err := os.Lstat(ancestor)
		if err == nil {
			break
		}
		if !os.IsNotExist(err) {
			return err
		}
		parent := filepath.Dir(ancestor)
		if parent == ancestor {
			return fmt.Errorf("missing owned ancestor")
		}
		ancestor = parent
	}
	resolved, err := filepath.EvalSymlinks(ancestor)
	if err != nil {
		return err
	}
	worktree, err := filepath.EvalSymlinks(r.fixture.owned.Worktree)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(worktree, resolved)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return fmt.Errorf("write escapes task worktree")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0600)
}
