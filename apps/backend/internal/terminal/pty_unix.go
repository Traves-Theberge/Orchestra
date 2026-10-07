//go:build !windows

package terminal

import (
	"os"
	"os/exec"

	"github.com/creack/pty"
)

type unixPTY struct {
	file *os.File
	cmd  *exec.Cmd
}

// startPTY starts the command attached to a creack/pty pseudo-terminal.
// It returns the PTY master file and started exec.Cmd for Session.PTY/Cmd.
func startPTY(spec ptyStartSpec) (ptyProcess, *os.File, *exec.Cmd, error) {
	c := exec.Command(spec.Command, spec.Args...)
	c.Dir = spec.Dir
	c.Env = append([]string(nil), spec.Env...)
	f, err := pty.Start(c)
	if err != nil {
		return nil, nil, nil, err
	}
	return &unixPTY{file: f, cmd: c}, f, c, nil
}

func (p *unixPTY) Read(b []byte) (int, error)  { return p.file.Read(b) }
func (p *unixPTY) Write(b []byte) (int, error) { return p.file.Write(b) }
func (p *unixPTY) Close() error                { return p.file.Close() }

func (p *unixPTY) Resize(rows, cols uint16) error {
	return pty.Setsize(p.file, &pty.Winsize{Rows: rows, Cols: cols})
}

func (p *unixPTY) Wait() error { return p.cmd.Wait() }

func (p *unixPTY) Kill() error {
	if p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}

func (p *unixPTY) Pid() int {
	if p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

// defaultShell returns the interactive shell for Unix terminals.
func defaultShell() (string, []string) {
	return "/bin/bash", nil
}
