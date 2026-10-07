//go:build windows

package terminal

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modKernel32                   = windows.NewLazySystemDLL("kernel32.dll")
	procCreatePseudoConsole       = modKernel32.NewProc("CreatePseudoConsole")
	procUpdateProcThreadAttribute = modKernel32.NewProc("UpdateProcThreadAttribute")
)

const (
	defaultConPTYCols = 80
	defaultConPTYRows = 24
)

// conPTY is a process attached to a Windows pseudo console (ConPTY).
//
// Lifecycle: a goroutine waits for the process to exit and then calls
// ClosePseudoConsole. Closing the console makes conhost release its end of the
// output pipe, so Read returns io.EOF once buffered output has drained. Because
// ClosePseudoConsole can block until the output pipe is drained, it never runs
// on a caller's goroutine; the session reader keeps draining meanwhile.
type conPTY struct {
	console windows.Handle
	output  windows.Handle // read end of the console's output pipe

	inputMu sync.RWMutex
	input   windows.Handle // write end of the console's input pipe
	lastCR  bool

	procMu   sync.Mutex
	process  windows.Handle
	pid      uint32
	exited   chan struct{}
	exitCode uint32

	consoleMu   sync.Mutex
	consoleOpen bool
	outputOnce  sync.Once
}

// startPTY starts the command inside a new ConPTY. Windows has no PTY master
// *os.File, so the returned file is nil; Cmd is unstarted metadata.
func startPTY(spec ptyStartSpec) (ptyProcess, *os.File, *exec.Cmd, error) {
	if err := procCreatePseudoConsole.Find(); err != nil {
		return nil, nil, nil, fmt.Errorf("ConPTY is unavailable (requires Windows 10 1809 or later): %w", err)
	}
	path, err := exec.LookPath(spec.Command)
	if err != nil {
		return nil, nil, nil, err
	}
	p, err := startConPTY(path, spec)
	if err != nil {
		return nil, nil, nil, err
	}
	return p, nil, commandMetadata(spec), nil
}

func startConPTY(path string, spec ptyStartSpec) (_ *conPTY, err error) {
	var inRead, inWrite, outRead, outWrite windows.Handle
	closeHandles := func(handles ...*windows.Handle) {
		for _, h := range handles {
			if *h != 0 && *h != windows.InvalidHandle {
				windows.CloseHandle(*h)
				*h = 0
			}
		}
	}
	defer func() {
		if err != nil {
			closeHandles(&inRead, &inWrite, &outRead, &outWrite)
		}
	}()
	if err = windows.CreatePipe(&inRead, &inWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("create input pipe: %w", err)
	}
	if err = windows.CreatePipe(&outRead, &outWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("create output pipe: %w", err)
	}

	var console windows.Handle
	size := windows.Coord{X: defaultConPTYCols, Y: defaultConPTYRows}
	if err = windows.CreatePseudoConsole(size, inRead, outWrite, 0, &console); err != nil {
		return nil, fmt.Errorf("create pseudo console: %w", err)
	}
	defer func() {
		if err != nil {
			windows.ClosePseudoConsole(console)
		}
	}()

	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, fmt.Errorf("allocate process attributes: %w", err)
	}
	defer attrs.Delete()
	// The HPCON value itself is the attribute payload. Call the API directly
	// rather than ProcThreadAttributeListContainer.Update, which would retain
	// the handle as an unsafe.Pointer visible to the garbage collector.
	r1, _, callErr := procUpdateProcThreadAttribute.Call(
		uintptr(unsafe.Pointer(attrs.List())),
		0,
		windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
		uintptr(console),
		unsafe.Sizeof(console),
		0,
		0,
	)
	if r1 == 0 {
		err = fmt.Errorf("attach pseudo console: %w", callErr)
		return nil, err
	}

	si := windows.StartupInfoEx{}
	si.Cb = uint32(unsafe.Sizeof(si))
	// Explicit invalid std handles stop the child from inheriting this
	// daemon's redirected stdio instead of the pseudo console.
	si.Flags = windows.STARTF_USESTDHANDLES
	si.StdInput = windows.InvalidHandle
	si.StdOutput = windows.InvalidHandle
	si.StdErr = windows.InvalidHandle
	si.ProcThreadAttributeList = attrs.List()

	appName, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{spec.Command}, spec.Args...)))
	if err != nil {
		return nil, err
	}
	var dir *uint16
	if spec.Dir != "" {
		if dir, err = windows.UTF16PtrFromString(spec.Dir); err != nil {
			return nil, err
		}
	}
	envBlock := createEnvBlock(spec.Env)

	var pi windows.ProcessInformation
	err = windows.CreateProcess(
		appName,
		commandLine,
		nil,
		nil,
		false,
		windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_UNICODE_ENVIRONMENT,
		&envBlock[0],
		dir,
		&si.StartupInfo,
		&pi,
	)
	if err != nil {
		return nil, fmt.Errorf("create process %q: %w", path, err)
	}
	windows.CloseHandle(pi.Thread)
	// The pseudo console owns duplicates of these ends now.
	closeHandles(&inRead, &outWrite)

	p := &conPTY{
		console:     console,
		output:      outRead,
		input:       inWrite,
		process:     pi.Process,
		pid:         pi.ProcessId,
		exited:      make(chan struct{}),
		consoleOpen: true,
	}
	go p.waitForExit()
	return p, nil
}

func (p *conPTY) waitForExit() {
	windows.WaitForSingleObject(p.process, windows.INFINITE)
	p.procMu.Lock()
	var code uint32
	if windows.GetExitCodeProcess(p.process, &code) == nil {
		p.exitCode = code
	}
	windows.CloseHandle(p.process)
	p.process = 0
	close(p.exited)
	p.procMu.Unlock()

	p.closeInput()
	// Runs while the session reader drains output; afterwards conhost has
	// released the output pipe and Read reports EOF.
	p.closeConsole()
}

func (p *conPTY) closeConsole() {
	p.consoleMu.Lock()
	defer p.consoleMu.Unlock()
	if !p.consoleOpen {
		return
	}
	p.consoleOpen = false
	windows.ClosePseudoConsole(p.console)
}

func (p *conPTY) closeInput() {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	if p.input != 0 {
		windows.CloseHandle(p.input)
		p.input = 0
	}
}

func (p *conPTY) closeOutput() {
	p.outputOnce.Do(func() { windows.CloseHandle(p.output) })
}

// Read returns console output. It reports io.EOF after the console closes.
// The output handle is released by the reading goroutine itself, so no
// handle is closed underneath an in-flight ReadFile.
func (p *conPTY) Read(b []byte) (int, error) {
	if len(b) == 0 {
		return 0, nil
	}
	var n uint32
	err := windows.ReadFile(p.output, b, &n, nil)
	if err != nil {
		p.closeOutput()
		if errors.Is(err, windows.ERROR_BROKEN_PIPE) || errors.Is(err, windows.ERROR_HANDLE_EOF) || errors.Is(err, windows.ERROR_INVALID_HANDLE) {
			return int(n), io.EOF
		}
		return int(n), err
	}
	return int(n), nil
}

// Write sends input to the console. Line feeds are normalized to carriage
// returns, which is what a terminal sends for Enter (xterm.js already sends
// "\r"; initial commands are sent with "\n").
func (p *conPTY) Write(b []byte) (int, error) {
	p.inputMu.Lock()
	defer p.inputMu.Unlock()
	if p.input == 0 {
		return 0, os.ErrClosed
	}
	data := make([]byte, 0, len(b))
	for _, c := range b {
		if c == '\n' {
			if !p.lastCR {
				data = append(data, '\r')
			}
			p.lastCR = false
			continue
		}
		p.lastCR = c == '\r'
		data = append(data, c)
	}
	for len(data) > 0 {
		var n uint32
		if err := windows.WriteFile(p.input, data, &n, nil); err != nil {
			return 0, err
		}
		data = data[n:]
	}
	return len(b), nil
}

func (p *conPTY) Resize(rows, cols uint16) error {
	if rows == 0 || cols == 0 {
		return nil
	}
	if rows > 0x7fff {
		rows = 0x7fff
	}
	if cols > 0x7fff {
		cols = 0x7fff
	}
	p.consoleMu.Lock()
	defer p.consoleMu.Unlock()
	if !p.consoleOpen {
		return os.ErrClosed
	}
	return windows.ResizePseudoConsole(p.console, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (p *conPTY) Wait() error {
	<-p.exited
	if p.exitCode != 0 {
		return fmt.Errorf("exit status %d", p.exitCode)
	}
	return nil
}

func (p *conPTY) Kill() error {
	p.procMu.Lock()
	defer p.procMu.Unlock()
	select {
	case <-p.exited:
		return nil
	default:
	}
	return windows.TerminateProcess(p.process, 1)
}

func (p *conPTY) Pid() int { return int(p.pid) }

// Close terminates the shell and closes input. It never blocks: the exit
// watcher closes the pseudo console, which ends Read with io.EOF.
func (p *conPTY) Close() error {
	err := p.Kill()
	p.closeInput()
	return err
}

// createEnvBlock builds a CREATE_UNICODE_ENVIRONMENT block. Later duplicates
// win (case-insensitively) and SYSTEMROOT is preserved, matching os/exec.
func createEnvBlock(env []string) []uint16 {
	keys := make(map[string]int, len(env))
	entries := make([]string, 0, len(env)+1)
	for _, entry := range env {
		if entry == "" || strings.IndexByte(entry, 0) >= 0 {
			continue
		}
		key := envKey(entry)
		if i, ok := keys[key]; ok {
			entries[i] = entry
			continue
		}
		keys[key] = len(entries)
		entries = append(entries, entry)
	}
	if _, ok := keys["SYSTEMROOT"]; !ok {
		if root := os.Getenv("SYSTEMROOT"); root != "" {
			entries = append(entries, "SYSTEMROOT="+root)
		}
	}
	var block []uint16
	for _, entry := range entries {
		block = append(block, utf16.Encode([]rune(entry))...)
		block = append(block, 0)
	}
	if len(block) == 0 {
		block = append(block, 0)
	}
	return append(block, 0)
}

func envKey(entry string) string {
	// Drive-cwd entries such as "=C:=C:\dir" start with '='.
	if i := strings.IndexByte(entry[1:], '='); i >= 0 {
		return strings.ToUpper(entry[:i+1])
	}
	return strings.ToUpper(entry)
}

// defaultShell picks the Windows interactive shell: ORCHESTRA_TERMINAL_SHELL
// (a program path), then pwsh, Windows PowerShell, and finally %COMSPEC%.
func defaultShell() (string, []string) {
	if shell := strings.TrimSpace(os.Getenv("ORCHESTRA_TERMINAL_SHELL")); shell != "" {
		return shell, nil
	}
	for _, name := range []string{"pwsh.exe", "powershell.exe"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, []string{"-NoLogo"}
		}
	}
	if comspec := strings.TrimSpace(os.Getenv("COMSPEC")); comspec != "" {
		return comspec, nil
	}
	return "cmd.exe", nil
}
