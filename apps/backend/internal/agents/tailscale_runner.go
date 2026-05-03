package agents

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

// TailscaleRunner executes agent turns on a remote node over SSH-over-Tailscale.
//
// The runner assumes the remote node is already reachable (i.e. orchestrad is
// running on a Tailscale-enrolled host and the target resolves via Tailscale DNS
// or a direct .ts.net hostname). It does not manage Tailscale auth itself.
//
// Bootstrap flow per turn:
//  1. SSH dial to the configured host:port
//  2. Ensure the remote worktree exists (git clone on first run, pull otherwise)
//  3. Execute the agent command inside that directory
//  4. Stream stdout/stderr line-by-line through parseLineToEvent
//  5. Return on process exit or context cancellation
type TailscaleRunner struct {
	wrappedProvider Provider
	command         string
	host            string
	user            string
	keyPath         string
	port            int
	remoteRoot      string
}

// NewTailscaleRunner creates a runner that dispatches via SSH to a Tailscale node.
// wrappedProvider is the AI provider this transport will execute (e.g. ProviderClaude).
// host is the Tailscale DNS name or IP. port is typically 22.
// keyPath may be empty, in which case the SSH agent ($SSH_AUTH_SOCK) is used.
func NewTailscaleRunner(wrappedProvider Provider, command, host, user, keyPath string, port int, remoteRoot string) *TailscaleRunner {
	if user == "" {
		user = "root"
	}
	if port == 0 {
		port = 22
	}
	if remoteRoot == "" {
		remoteRoot = "/tmp/orchestra-worktrees"
	}
	return &TailscaleRunner{
		wrappedProvider: wrappedProvider,
		command:         strings.TrimSpace(command),
		host:            host,
		user:            user,
		keyPath:         keyPath,
		port:            port,
		remoteRoot:      remoteRoot,
	}
}

// WrapCommand implements RuntimeTransport. Returns a new TailscaleRunner
// configured to run the given provider's command on the remote node.
func (r *TailscaleRunner) WrapCommand(provider Provider, command string) Runner {
	return &TailscaleRunner{
		wrappedProvider: provider,
		command:         command,
		host:            r.host,
		user:            r.user,
		keyPath:         r.keyPath,
		port:            r.port,
		remoteRoot:      r.remoteRoot,
	}
}

// RunTurn connects to the Tailscale node, syncs the worktree, executes the
// agent command, and streams events back via onEvent.
func (r *TailscaleRunner) RunTurn(ctx context.Context, request TurnRequest, onEvent EventHandler) (TurnResult, error) {
	sessionID := request.SessionID
	if sessionID == "" {
		sessionID = fmt.Sprintf("tailscale-%s-%d", request.IssueIdentifier, time.Now().UnixNano())
	}

	emit := func(kind, message string, raw map[string]any) {
		if onEvent != nil {
			onEvent(Event{
				Provider:  r.wrappedProvider,
				SessionID: sessionID,
				Kind:      kind,
				Message:   message,
				Raw:       raw,
				Timestamp: time.Now().UTC(),
			})
		}
	}

	// Build SSH client config.
	authMethods, err := r.authMethods()
	if err != nil {
		emit("error", fmt.Sprintf("SSH auth setup failed: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	sshConfig := &ssh.ClientConfig{
		User:            r.user,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), //nolint:gosec — Tailscale mesh; host identity is provided by WireGuard
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", r.host, r.port)
	emit("connecting", fmt.Sprintf("SSH dial %s", addr), nil)

	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		emit("error", fmt.Sprintf("SSH dial failed: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}
	defer client.Close()

	emit("connected", fmt.Sprintf("connected to %s@%s", r.user, r.host), nil)

	// Derive a stable worktree directory name from the issue identifier.
	safeName := strings.ToLower(strings.NewReplacer(" ", "-", "/", "-", ".", "-").Replace(request.IssueIdentifier))
	if safeName == "" {
		safeName = sessionID
	}
	workDir := r.remoteRoot + "/" + safeName

	// Bootstrap: ensure the worktree exists on the remote.
	if err := r.bootstrap(ctx, client, request, workDir, emit); err != nil {
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	// Build the agent command.
	commandLine := r.command
	if strings.TrimSpace(request.CommandOverride) != "" {
		commandLine = strings.TrimSpace(request.CommandOverride)
	}
	finalPrompt := strings.TrimSpace(request.Prompt)
	var agentCmd string
	if commandLine != "" {
		agentCmd = strings.ReplaceAll(commandLine, "{{prompt}}", shellQuote(finalPrompt))
	} else {
		agentCmd = finalPrompt
	}
	agentCmd = fmt.Sprintf("cd %s && %s", shellQuote(workDir), agentCmd)

	emit("RUN_STARTED", "executing agent on Tailscale node", map[string]any{"host": r.host, "work_dir": workDir})

	// Open a new session for the agent command.
	sess, err := client.NewSession()
	if err != nil {
		emit("error", fmt.Sprintf("SSH session failed: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}
	defer sess.Close()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1}, err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1}, err
	}

	if err := sess.Start(agentCmd); err != nil {
		emit("error", fmt.Sprintf("agent start failed: %s", err), nil)
		return TurnResult{Provider: r.wrappedProvider, SessionID: sessionID, ExitCode: 1, Output: err.Error()}, err
	}

	// Cancel the SSH session when the context is done.
	go func() {
		<-ctx.Done()
		_ = sess.Signal(ssh.SIGTERM)
		_ = sess.Close()
	}()

	collector := &outputCollector{}

	streamLines := func(reader interface{ Read([]byte) (int, error) }, source string) {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			line := scanner.Text()
			collector.append(line)
			event := parseLineToEvent(r.wrappedProvider, source, line)
			event.SessionID = sessionID
			if onEvent != nil {
				onEvent(event)
			}
			collector.mergeUsage(event.Usage)
		}
	}

	done := make(chan struct{}, 2)
	go func() { streamLines(stdout, "stdout"); done <- struct{}{} }()
	go func() { streamLines(stderr, "stderr"); done <- struct{}{} }()
	<-done
	<-done

	waitErr := sess.Wait()
	exitCode := 0
	if waitErr != nil {
		exitCode = 1
		if exErr, ok := waitErr.(*ssh.ExitError); ok {
			exitCode = exErr.ExitStatus()
		}
	}

	emit("turn.completed", fmt.Sprintf("agent exited with code %d", exitCode), map[string]any{"exit_code": exitCode})

	return TurnResult{
		Provider:  r.wrappedProvider,
		SessionID: sessionID,
		ExitCode:  exitCode,
		Output:    collector.output(),
		Usage:     collector.usage(),
	}, nil
}

// bootstrap ensures the remote worktree directory exists and is up-to-date.
func (r *TailscaleRunner) bootstrap(ctx context.Context, client *ssh.Client, request TurnRequest, workDir string, emit func(string, string, map[string]any)) error {
	repoURL := ""
	if request.Workspace != "" {
		repoURL = detectGitRemoteURL(request.Workspace)
	}

	var bootstrapCmd string
	if repoURL != "" {
		bootstrapCmd = fmt.Sprintf(
			"mkdir -p %s && (git -C %s pull --rebase 2>/dev/null || git clone %s %s)",
			shellQuote(r.remoteRoot),
			shellQuote(workDir),
			shellQuote(repoURL),
			shellQuote(workDir),
		)
	} else {
		bootstrapCmd = fmt.Sprintf("mkdir -p %s", shellQuote(workDir))
	}

	emit("bootstrap", "preparing remote worktree", nil)
	if out, err := r.runCommand(ctx, client, bootstrapCmd); err != nil {
		emit("bootstrap_warning", fmt.Sprintf("worktree setup failed: %s — %s", err, out), nil)
	}
	return nil
}

// runCommand opens a short-lived SSH session to execute a single command and
// returns its combined output.
func (r *TailscaleRunner) runCommand(ctx context.Context, client *ssh.Client, cmd string) (string, error) {
	sess, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer sess.Close()

	go func() {
		<-ctx.Done()
		_ = sess.Close()
	}()

	out, err := sess.CombinedOutput(cmd)
	return string(out), err
}

// authMethods builds the SSH authentication methods in priority order:
// explicit key file → SSH agent → error.
func (r *TailscaleRunner) authMethods() ([]ssh.AuthMethod, error) {
	var methods []ssh.AuthMethod

	// 1. Explicit private key file.
	if r.keyPath != "" {
		keyData, err := os.ReadFile(r.keyPath)
		if err != nil {
			return nil, fmt.Errorf("read SSH key %q: %w", r.keyPath, err)
		}
		signer, err := ssh.ParsePrivateKey(keyData)
		if err != nil {
			return nil, fmt.Errorf("parse SSH key %q: %w", r.keyPath, err)
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	// 2. SSH agent forwarding via $SSH_AUTH_SOCK.
	if sockPath := os.Getenv("SSH_AUTH_SOCK"); sockPath != "" {
		conn, err := net.Dial("unix", sockPath)
		if err == nil {
			methods = append(methods, ssh.PublicKeysCallback(agent.NewClient(conn).Signers))
		}
	}

	if len(methods) == 0 {
		return nil, fmt.Errorf("no SSH auth available: set ORCHESTRA_TAILSCALE_SSH_KEY or SSH_AUTH_SOCK")
	}
	return methods, nil
}

// detectGitRemoteURL reads the origin remote URL from a local git repo's config.
func detectGitRemoteURL(workspacePath string) string {
	data, err := os.ReadFile(workspacePath + "/.git/config")
	if err != nil {
		return ""
	}
	lines := strings.Split(string(data), "\n")
	inOrigin := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == `[remote "origin"]` {
			inOrigin = true
			continue
		}
		if inOrigin && strings.HasPrefix(trimmed, "url = ") {
			return strings.TrimPrefix(trimmed, "url = ")
		}
		if strings.HasPrefix(trimmed, "[") {
			inOrigin = false
		}
	}
	return ""
}
