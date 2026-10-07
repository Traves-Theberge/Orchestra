package terminal

import (
	"io"
	"os/exec"
)

// ptyProcess is a shell process attached to a pseudo-terminal. Unix uses
// creack/pty; Windows uses ConPTY. Read must return an error (io.EOF) once the
// process has exited and its output has drained so session readers terminate.
type ptyProcess interface {
	io.ReadWriteCloser
	Resize(rows, cols uint16) error
	Wait() error
	Kill() error
	Pid() int
}

// ptyStartSpec describes the process to start inside a pseudo-terminal.
type ptyStartSpec struct {
	Command string
	Args    []string
	Dir     string
	Env     []string
}

// commandMetadata returns an unstarted exec.Cmd describing the process. It is
// kept on Session.Cmd for callers that inspect Path/Args/Dir/Env.
func commandMetadata(spec ptyStartSpec) *exec.Cmd {
	c := exec.Command(spec.Command, spec.Args...)
	c.Dir = spec.Dir
	c.Env = append([]string(nil), spec.Env...)
	return c
}
