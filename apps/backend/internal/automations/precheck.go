package automations

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/shellcommand"
)

const maxPrecheckOutput = 16 * 1024

// PrecheckFunc runs a shell command in dir and reports its outcome.
type PrecheckFunc func(ctx context.Context, dir, command string, timeout time.Duration) PrecheckResult

type cappedBuffer struct {
	buf       bytes.Buffer
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	room := maxPrecheckOutput - c.buf.Len()
	if room > 0 {
		if len(p) > room {
			c.buf.Write(p[:room])
			c.truncated = true
		} else {
			c.buf.Write(p)
		}
	} else if len(p) > 0 {
		c.truncated = true
	}
	return len(p), nil
}

func (c *cappedBuffer) String() string {
	if c.truncated {
		return c.buf.String() + "\n[output truncated]"
	}
	return c.buf.String()
}

// RunPrecheck executes command through the POSIX shell used for hooks. The
// process tree is killed on timeout. Exit code -1 means it could not run or
// timed out.
func RunPrecheck(ctx context.Context, dir, command string, timeout time.Duration) PrecheckResult {
	if timeout <= 0 {
		timeout = DefaultPrecheckTimeout * time.Second
	}
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	res := PrecheckResult{ExitCode: -1}
	cmd, err := shellcommand.CommandContext(ctx, command)
	if err != nil {
		res.Stderr = err.Error()
		res.DurationMS = time.Since(start).Milliseconds()
		return res
	}
	cmd.Dir = dir
	var stdout, stderr cappedBuffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err = cmd.Run()
	res.DurationMS = time.Since(start).Milliseconds()
	res.Stdout, res.Stderr = stdout.String(), stderr.String()
	var exitErr *exec.ExitError
	switch {
	case ctx.Err() == context.DeadlineExceeded:
		res.ExitCode = -1
		if res.Stderr != "" {
			res.Stderr += "\n"
		}
		res.Stderr += "Precheck timed out after " + timeout.String() + "; process tree killed."
	case err == nil:
		res.ExitCode = 0
	case errors.As(err, &exitErr):
		res.ExitCode = exitErr.ExitCode()
	default:
		if res.Stderr != "" {
			res.Stderr += "\n"
		}
		res.Stderr += err.Error()
	}
	return res
}
