package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"syscall"
)

type ServiceStatus int

const (
	StatusStopped ServiceStatus = iota
	StatusStarting
	StatusRunning
	StatusError
)

type Service struct {
	Name    string
	Cmd     string
	Cwd     string
	Env     []string
	Status  ServiceStatus
	Logs    []string
	mu      sync.Mutex
	cancel  context.CancelFunc
	cmd     *exec.Cmd
	onEvent func()
}

func (s *Service) Start(onEvent func()) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.Status == StatusRunning || s.Status == StatusStarting {
		return
	}

	s.Status = StatusStarting
	s.onEvent = onEvent
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	go s.run(ctx)
}

func (s *Service) run(ctx context.Context) {
	cmd := exec.CommandContext(ctx, "bash", "-c", s.Cmd)
	cmd.Dir = s.Cwd
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, s.Env...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	s.mu.Lock()
	s.cmd = cmd
	s.mu.Unlock()

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		s.mu.Lock()
		s.Status = StatusError
		s.Logs = append(s.Logs, fmt.Sprintf("Error starting: %v", err))
		s.mu.Unlock()
		s.onEvent()
		return
	}

	s.mu.Lock()
	s.Status = StatusRunning
	s.Logs = append(s.Logs, fmt.Sprintf(">>> %s process started: %s", s.Name, s.Cmd))
	s.mu.Unlock()
	s.onEvent()

	var wg sync.WaitGroup
	wg.Add(2)

	captureLogs := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			s.mu.Lock()
			line := scanner.Text()
			s.Logs = append(s.Logs, line)
			if len(s.Logs) > 200 {
				s.Logs = s.Logs[1:]
			}
			s.mu.Unlock()
			s.onEvent()
		}
	}

	go captureLogs(stdout)
	go captureLogs(stderr)

	_ = cmd.Wait()
	wg.Wait()

	s.mu.Lock()
	if s.Status != StatusError && s.Status != StatusStopped {
		s.Status = StatusStopped
	}
	s.mu.Unlock()
	s.onEvent()
}

func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cancel != nil {
		s.cancel()
	}
	if s.cmd != nil && s.cmd.Process != nil {
		// Kill the entire process group
		_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
	}
	s.Status = StatusStopped
	s.Logs = append(s.Logs, fmt.Sprintf(">>> %s stopped", s.Name))
	s.onEvent()
}
