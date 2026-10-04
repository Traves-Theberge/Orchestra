package workspace

import (
	"context"
	"errors"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/shellcommand"
	"time"
)

// HookResult holds the combined stdout/stderr output from a workspace hook execution.
type HookResult struct {
	Output string
}

// RunHook executes the given shell script in the specified working directory
// with the given timeout, returning the combined output.
func RunHook(name string, script string, cwd string, timeout time.Duration) (HookResult, error) {
	if script == "" {
		return HookResult{}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd, err := shellcommand.CommandContext(ctx, script)
	if err != nil {
		return HookResult{}, err
	}
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	result := HookResult{Output: string(out)}

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return result, fmt.Errorf("workspace hook timeout: hook=%s timeout=%s", name, timeout)
	}

	if err != nil {
		return result, fmt.Errorf("workspace hook failed: hook=%s err=%w", name, err)
	}

	return result, nil
}
