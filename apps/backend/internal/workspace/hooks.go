package workspace

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"time"
)

type HookResult struct {
	Output string
}

func RunHook(name string, script string, cwd string, timeout time.Duration) (HookResult, error) {
	if script == "" {
		return HookResult{}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-lc", script)
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
