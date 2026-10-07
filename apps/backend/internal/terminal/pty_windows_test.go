//go:build windows

package terminal

import (
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/acarl005/stripansi"
)

type outputWatcher struct {
	mu  sync.Mutex
	buf strings.Builder
}

func (w *outputWatcher) handle(data []byte) {
	w.mu.Lock()
	w.buf.Write(data)
	w.mu.Unlock()
}

func (w *outputWatcher) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

func (w *outputWatcher) waitFor(t *testing.T, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if strings.Contains(stripansi.Strip(w.String()), want) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("output never contained %q; got %q", want, w.String())
}

func comspec() string {
	if c := os.Getenv("COMSPEC"); c != "" {
		return c
	}
	return "cmd.exe"
}

func waitClosed(t *testing.T, s *Session, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		s.mu.Lock()
		closed := s.Closed
		s.mu.Unlock()
		if closed {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("session did not close")
}

func TestConPTYCommandOutputReachesHandlerAndSessionEnds(t *testing.T) {
	manager := NewManager()
	s, err := manager.CreateSession("echo", t.TempDir(), comspec(), "/c", "echo orchestra-pty-ok")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	w := &outputWatcher{}
	s.AddHandler(w.handle)
	w.waitFor(t, "orchestra-pty-ok", 10*time.Second)
	// Process exit must end the reader (EOF) and close the session.
	waitClosed(t, s, 10*time.Second)
	if dirs := manager.ActiveDirectories(); len(dirs) != 0 {
		t.Fatalf("closed session still active: %v", dirs)
	}
}

func TestConPTYInteractiveShellWriteResizeClose(t *testing.T) {
	manager := NewManager()
	dir := t.TempDir()
	s, err := manager.CreateSession("interactive", dir, comspec())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if s.Cmd == nil || s.Cmd.Dir != dir || s.Dir != dir {
		t.Fatalf("session directory metadata missing: %#v", s.Cmd)
	}
	if dirs := manager.ActiveDirectories(); len(dirs) != 1 || dirs[0] != dir {
		t.Fatalf("active directories = %v", dirs)
	}
	w := &outputWatcher{}
	s.AddHandler(w.handle)

	if err := s.Resize(40, 120); err != nil {
		t.Fatalf("resize: %v", err)
	}
	if _, err := s.Write([]byte("echo hello\r\n")); err != nil {
		t.Fatal(err)
	}
	w.waitFor(t, "\nhello", 10*time.Second)
	// Bare "\n" (desktop initial commands) must act as Enter too.
	if _, err := s.Write([]byte("echo lf-enter-ok\n")); err != nil {
		t.Fatal(err)
	}
	w.waitFor(t, "\nlf-enter-ok", 10*time.Second)

	pid := s.proc.Pid()
	done := make(chan struct{})
	go func() {
		s.Close()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Close hung")
	}
	waitErr := make(chan error, 1)
	go func() { waitErr <- s.proc.Wait() }()
	select {
	case <-waitErr:
	case <-time.After(5 * time.Second):
		t.Fatalf("process %d still running after Close", pid)
	}
	if _, err := s.Write([]byte("echo late\r\n")); err == nil {
		t.Fatal("write after close succeeded")
	}
}

func TestConPTYScopedEnvironmentAndPowerShell(t *testing.T) {
	shell, args := DefaultShell()
	if shell == "" {
		t.Fatal("no default shell")
	}
	manager := NewManager()
	env := append(os.Environ(), "ORCHESTRA_PTY_PROBE=scoped-env-ok")
	s, err := manager.CreateSessionWithEnv("env", t.TempDir(), env, comspec(), "/c", "echo %ORCHESTRA_PTY_PROBE%")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	w := &outputWatcher{}
	s.AddHandler(w.handle)
	w.waitFor(t, "scoped-env-ok", 10*time.Second)

	if !strings.Contains(strings.ToLower(shell), "powershell") && !strings.Contains(strings.ToLower(shell), "pwsh") {
		t.Logf("default shell %q is not PowerShell; skipping PowerShell probe", shell)
		return
	}
	ps, err := manager.CreateSession("ps", t.TempDir(), shell, append(args, "-NoProfile", "-Command", "Write-Output orchestra-pty-ok")...)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(ps.Close)
	pw := &outputWatcher{}
	ps.AddHandler(pw.handle)
	pw.waitFor(t, "orchestra-pty-ok", 20*time.Second)
	waitClosed(t, ps, 20*time.Second)
}

func TestCreateEnvBlockDedupesCaseInsensitively(t *testing.T) {
	block := createEnvBlock([]string{"Path=a", "PATH=b", "=C:=C:\\x", "FOO=1"})
	var entries []string
	start := 0
	for i, c := range block {
		if c == 0 {
			if i == start {
				break
			}
			entries = append(entries, string(utf16Decode(block[start:i])))
			start = i + 1
		}
	}
	got := strings.Join(entries, "|")
	if !strings.HasPrefix(got, "PATH=b|=C:=C:\\x|FOO=1") {
		t.Fatalf("env block = %q", got)
	}
}

func utf16Decode(s []uint16) []rune {
	r := make([]rune, len(s))
	for i, c := range s {
		r[i] = rune(c)
	}
	return r
}
