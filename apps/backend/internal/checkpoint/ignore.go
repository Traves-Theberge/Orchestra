package checkpoint

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// ignoreChecker answers "is this path ignored?" for any number of batches
// with one long-lived `git check-ignore --stdin` process, so a walk costs one
// process spawn no matter how many levels it checks.
//
// Protocol: for each batch a writer goroutine sends the NUL-terminated paths
// while the caller reads exactly four NUL-terminated fields per path
// (-v -n --non-matching: source, line, pattern, path). Writing and reading run
// concurrently, so neither pipe can fill up and deadlock, and the next batch
// starts only after every reply of the previous one has been read.
//
// Git bug workaround: with -v, git (seen with 2.55.0.windows.4) prints the
// matching pattern's source through a pointer into an array that is
// reallocated once a path has more than about 24 components, so for such
// paths it prints garbage or crashes (exit 0xc0000005). Paths deeper than
// maxVerboseComponents are therefore checked by a one-shot
// `check-ignore --stdin -z` without -v (one process per batch, which only
// happens in folders more than 20 levels deep). If the long-lived process
// dies for any other reason, every later batch uses the one-shot form too.
// A dead process can never yield a wrong answer: each path needs its four
// fields, so a short reply is an error, not a result.
type ignoreChecker struct {
	ctx      context.Context
	g        gitRun
	p        *ignoreProc
	fellBack bool // the long-lived process died; use one-shot checks
	closed   bool
}

const maxVerboseComponents = 20

// onIgnoreFallback, when set (tests only), is called with the error that made
// the checker give up its long-lived process.
var onIgnoreFallback func(err error)

// ignoreProc is one running check-ignore process.
type ignoreProc struct {
	ctx    context.Context
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	out    *bufio.Reader
	stderr bytes.Buffer // drained by os/exec's own goroutine
	closed bool
}

// startIgnoreChecker returns a checker; the git process starts on first use.
func startIgnoreChecker(ctx context.Context, g gitRun) (*ignoreChecker, error) {
	if _, err := exec.LookPath("git"); err != nil {
		return nil, fmt.Errorf("%w: git not found: %v", ErrUnavailable, err)
	}
	return &ignoreChecker{ctx: ctx, g: g}, nil
}

func startIgnoreProc(ctx context.Context, g gitRun) (*ignoreProc, error) {
	// check-ignore rejects GIT_LITERAL_PATHSPECS; paths are made literal by the
	// "./" prefix in check instead. GIT_FLUSH=1 makes git answer each path
	// immediately instead of buffering its output.
	cmd, err := g.command(ctx, []string{"GIT_LITERAL_PATHSPECS=0", "GIT_FLUSH=1"},
		"check-ignore", "--no-index", "--stdin", "-z", "-v", "-n", "--non-matching")
	if err != nil {
		return nil, err
	}
	p := &ignoreProc{ctx: ctx, cmd: cmd}
	cmd.Stderr = &p.stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		stdin.Close()
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if err := cmd.Start(); err != nil {
		stdin.Close()
		stdout.Close()
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: running git: %v", ErrUnavailable, err)
	}
	p.stdin, p.out = stdin, bufio.NewReader(stdout)
	return p, nil
}

// check reports, for each slash-separated path relative to the work tree,
// whether ignore rules exclude it.
func (c *ignoreChecker) check(paths []string) ([]bool, error) {
	if c.closed {
		return nil, fmt.Errorf("git check-ignore: checker already closed")
	}
	if len(paths) == 0 {
		return nil, nil
	}
	var shallow, deep []int
	for i, p := range paths {
		if !c.fellBack && strings.Count(p, "/")+1 <= maxVerboseComponents {
			shallow = append(shallow, i)
		} else {
			deep = append(deep, i)
		}
	}
	res := make([]bool, len(paths))
	if len(shallow) > 0 {
		sub := pick(paths, shallow)
		got, err := c.procCheck(sub)
		if err != nil {
			return nil, err
		}
		if got == nil { // the process died: check these one-shot as well
			deep = append(deep, shallow...)
		} else {
			for k, i := range shallow {
				res[i] = got[k]
			}
		}
	}
	if len(deep) > 0 {
		got, err := c.oneShot(pick(paths, deep))
		if err != nil {
			return nil, err
		}
		for k, i := range deep {
			res[i] = got[k]
		}
	}
	return res, nil
}

func pick(paths []string, idx []int) []string {
	out := make([]string, len(idx))
	for k, i := range idx {
		out[k] = paths[i]
	}
	return out
}

// procCheck asks the long-lived process (starting it on first use). It
// returns nil, nil when the process died, after switching to one-shot mode.
func (c *ignoreChecker) procCheck(paths []string) ([]bool, error) {
	if c.p == nil {
		p, err := startIgnoreProc(c.ctx, c.g)
		if err != nil {
			return nil, err
		}
		c.p = p
	}
	got, err := c.p.check(paths)
	if err == nil {
		return got, nil
	}
	c.p.close()
	c.p = nil
	if c.ctx.Err() != nil {
		return nil, c.ctx.Err()
	}
	c.fellBack = true
	if onIgnoreFallback != nil {
		onIgnoreFallback(err)
	}
	return nil, nil
}

// oneShot checks paths with a single `check-ignore --stdin -z` run (no -v),
// which prints exactly the ignored paths, as sent.
func (c *ignoreChecker) oneShot(paths []string) ([]bool, error) {
	sent := make([]string, len(paths))
	for i, p := range paths {
		sent[i] = "./" + p // never pathspec magic
	}
	out, code, stderr, err := c.g.execEnv(c.ctx, []string{"GIT_LITERAL_PATHSPECS=0"}, joinNul(sent),
		"check-ignore", "--no-index", "--stdin", "-z")
	if err != nil {
		return nil, err
	}
	if code != 0 && code != 1 { // 1 means nothing ignored
		return nil, fmt.Errorf("git check-ignore: exit status %d: %s", code, stderr)
	}
	ignored := map[string]bool{}
	for _, p := range splitNul(out) {
		ignored[p] = true
	}
	res := make([]bool, len(paths))
	for i, s := range sent {
		res[i] = ignored[s]
	}
	return res, nil
}

// close stops the process. It is safe to call more than once and on a nil
// checker.
func (c *ignoreChecker) close() {
	if c == nil || c.closed {
		return
	}
	c.closed = true
	if c.p != nil {
		c.p.close()
		c.p = nil
	}
}

func (p *ignoreProc) check(paths []string) ([]bool, error) {
	if p.closed {
		return nil, fmt.Errorf("git check-ignore: process already closed")
	}
	werr := make(chan error, 1)
	go func() {
		w := bufio.NewWriter(p.stdin)
		for _, path := range paths {
			// "./" keeps names such as ":(foo)" or ":!x" from being read as
			// pathspec magic.
			w.WriteString("./" + path)
			w.WriteByte(0)
		}
		werr <- w.Flush()
	}()
	res := make([]bool, len(paths))
	for i := range paths {
		var f [4]string
		for j := range f {
			s, err := p.out.ReadString(0)
			if err != nil {
				return nil, p.fail(werr, fmt.Errorf("after %d of %d replies: %v", i, len(paths), err))
			}
			f[j] = strings.TrimSuffix(s, "\x00")
		}
		// No match leaves the pattern empty; a matching negated pattern
		// ("!x") means the path is not ignored.
		res[i] = f[2] != "" && !strings.HasPrefix(f[2], "!")
	}
	if err := <-werr; err != nil {
		return nil, p.fail(nil, err)
	}
	return res, nil
}

// fail stops the process, waits for the writer goroutine and returns the
// most useful error.
func (p *ignoreProc) fail(werr chan error, err error) error {
	p.close()
	if werr != nil {
		<-werr // unblocked: the process is gone, so its stdin pipe is broken
	}
	if p.ctx.Err() != nil {
		return p.ctx.Err()
	}
	return fmt.Errorf("git check-ignore: %v (%v): %s", err, p.cmd.ProcessState, strings.TrimSpace(p.stderr.String()))
}

// close kills the process and reaps it; safe to call more than once.
func (p *ignoreProc) close() {
	if p.closed {
		return
	}
	p.closed = true
	p.stdin.Close()
	_ = p.cmd.Process.Kill()
	_ = p.cmd.Wait() // also closes stdout and waits for stderr to be drained
}
