package harnesssetup

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"io"
	"net/url"
	"os/exec"
	"sync"
	"time"
)

type DeviceLoginState string

const (
	DeviceStarting  DeviceLoginState = "starting"
	DevicePending   DeviceLoginState = "pending"
	DeviceSucceeded DeviceLoginState = "succeeded"
	DeviceFailed    DeviceLoginState = "failed"
	DeviceCanceled  DeviceLoginState = "canceled"
	DeviceExpired   DeviceLoginState = "expired"
)

type DeviceLoginSnapshot struct {
	ID              string           `json:"id"`
	AccountID       string           `json:"account_id,omitempty"`
	State           DeviceLoginState `json:"state"`
	UserCode        string           `json:"user_code,omitempty"`
	VerificationURL string           `json:"verification_url,omitempty"`
	Message         string           `json:"message,omitempty"`
}

type deviceAttempt struct {
	snapshot DeviceLoginSnapshot
	cancel   context.CancelFunc
	ready    chan struct{}
	once     sync.Once
}

type DeviceLoginManager struct {
	mu      sync.Mutex
	current *deviceAttempt
}

func NewDeviceLoginManager() *DeviceLoginManager { return &DeviceLoginManager{} }

func (m *DeviceLoginManager) snapshot(attempt *deviceAttempt) DeviceLoginSnapshot {
	m.mu.Lock()
	defer m.mu.Unlock()
	return attempt.snapshot
}

func (m *DeviceLoginManager) update(attempt *deviceAttempt, state DeviceLoginState, message string) {
	m.mu.Lock()
	if attempt.snapshot.State == DeviceStarting || attempt.snapshot.State == DevicePending {
		attempt.snapshot.State = state
		attempt.snapshot.Message = message
	}
	m.mu.Unlock()
	if state != DeviceStarting {
		attempt.once.Do(func() { close(attempt.ready) })
	}
}

func (m *DeviceLoginManager) Start(ctx context.Context, executable string) (DeviceLoginSnapshot, error) {
	return m.StartInHome(ctx, executable, "", "")
}

// StartInHome runs provider-owned login in a single isolated credential home.
func (m *DeviceLoginManager) StartInHome(ctx context.Context, executable, home, accountID string) (DeviceLoginSnapshot, error) {
	m.mu.Lock()
	if current := m.current; current != nil && (current.snapshot.State == DeviceStarting || current.snapshot.State == DevicePending) {
		if current.snapshot.AccountID != accountID {
			m.mu.Unlock()
			return DeviceLoginSnapshot{}, errors.New("another Codex sign-in is already in progress")
		}
		snapshot := current.snapshot
		m.mu.Unlock()
		return snapshot, nil
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		m.mu.Unlock()
		return DeviceLoginSnapshot{}, err
	}
	runCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	attempt := &deviceAttempt{snapshot: DeviceLoginSnapshot{ID: hex.EncodeToString(id[:]), AccountID: accountID, State: DeviceStarting}, cancel: cancel, ready: make(chan struct{})}
	m.current = attempt
	m.mu.Unlock()

	command := exec.CommandContext(runCtx, executable, "app-server")
	if home != "" {
		command.Env = harnessaccounts.CodexProcessEnv(home)
	}
	command.Stderr = io.Discard // CLI diagnostics can contain host/account details.
	stdin, err := command.StdinPipe()
	if err != nil {
		cancel()
		m.update(attempt, DeviceFailed, "Could not start Codex app-server.")
		return m.snapshot(attempt), err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		cancel()
		m.update(attempt, DeviceFailed, "Could not start Codex app-server.")
		return m.snapshot(attempt), err
	}
	if err := command.Start(); err != nil {
		cancel()
		m.update(attempt, DeviceFailed, "Could not start Codex app-server.")
		return m.snapshot(attempt), err
	}
	go m.run(runCtx, attempt, command, stdin, stdout)
	select {
	case <-attempt.ready:
	case <-ctx.Done():
		m.Cancel(attempt.snapshot.ID)
		return m.snapshot(attempt), ctx.Err()
	case <-time.After(15 * time.Second):
		m.Cancel(attempt.snapshot.ID)
		return m.snapshot(attempt), errors.New("Codex device login did not start in time")
	}
	snapshot := m.snapshot(attempt)
	if snapshot.State == DeviceFailed {
		return snapshot, errors.New(snapshot.Message)
	}
	return snapshot, nil
}

func (m *DeviceLoginManager) Get(id string) (DeviceLoginSnapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil || m.current.snapshot.ID != id {
		return DeviceLoginSnapshot{}, false
	}
	return m.current.snapshot, true
}

func (m *DeviceLoginManager) Cancel(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.current == nil || m.current.snapshot.ID != id {
		return false
	}
	if m.current.snapshot.State == DeviceStarting || m.current.snapshot.State == DevicePending {
		m.current.snapshot.State = DeviceCanceled
		m.current.snapshot.Message = "Sign-in canceled."
		m.current.once.Do(func() { close(m.current.ready) })
		m.current.cancel()
	}
	return true
}

func (m *DeviceLoginManager) run(ctx context.Context, attempt *deviceAttempt, command *exec.Cmd, stdin io.WriteCloser, stdout io.Reader) {
	defer func() {
		_ = stdin.Close()
		attempt.cancel()
		_ = command.Wait()
		m.mu.Lock()
		if attempt.snapshot.State == DeviceStarting || attempt.snapshot.State == DevicePending {
			if ctx.Err() == context.DeadlineExceeded {
				attempt.snapshot.State, attempt.snapshot.Message = DeviceExpired, "Device sign-in expired. Start again."
			} else {
				attempt.snapshot.State, attempt.snapshot.Message = DeviceFailed, "Codex app-server closed before sign-in completed."
			}
		}
		m.mu.Unlock()
		attempt.once.Do(func() { close(attempt.ready) })
	}()
	encoder := json.NewEncoder(stdin)
	send := func(id *int, method string, params any) error {
		request := map[string]any{"jsonrpc": "2.0", "method": method, "params": params}
		if id != nil {
			request["id"] = *id
		}
		return encoder.Encode(request)
	}
	initID, loginID := 1, 2
	if err := send(&initID, "initialize", map[string]any{"clientInfo": map[string]string{"name": "orchestra", "title": "Orchestra", "version": "1.0.0"}}); err != nil {
		m.update(attempt, DeviceFailed, "Could not initialize Codex app-server.")
		return
	}
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var expectedLoginID string
	for scanner.Scan() {
		var message struct {
			ID     *int            `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
			Result json.RawMessage `json:"result"`
			Error  *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			continue
		}
		if message.ID != nil && *message.ID == initID {
			if message.Error != nil || send(nil, "initialized", map[string]any{}) != nil || send(&loginID, "account/login/start", map[string]string{"type": "chatgptDeviceCode"}) != nil {
				m.update(attempt, DeviceFailed, "Codex app-server could not start device sign-in.")
				return
			}
			continue
		}
		if message.ID != nil && *message.ID == loginID {
			if message.Error != nil {
				m.update(attempt, DeviceFailed, "Codex rejected device sign-in. Check whether device authentication is enabled.")
				return
			}
			var result struct{ Type, LoginID, UserCode, VerificationURL string }
			parseErr := json.Unmarshal(message.Result, &result)
			verificationURL, urlErr := url.Parse(result.VerificationURL)
			if parseErr != nil || result.Type != "chatgptDeviceCode" || result.LoginID == "" || result.UserCode == "" || urlErr != nil || verificationURL.Scheme != "https" || verificationURL.Host == "" {
				m.update(attempt, DeviceFailed, "Codex returned an unrecognized device sign-in response.")
				return
			}
			expectedLoginID = result.LoginID
			m.mu.Lock()
			attempt.snapshot.UserCode, attempt.snapshot.VerificationURL = result.UserCode, result.VerificationURL
			m.mu.Unlock()
			m.update(attempt, DevicePending, "Enter the code at the verification page.")
			continue
		}
		if message.Method == "account/login/completed" && expectedLoginID != "" {
			var result struct {
				LoginID string `json:"loginId"`
				Success bool   `json:"success"`
			}
			if json.Unmarshal(message.Params, &result) == nil && result.LoginID == expectedLoginID {
				if result.Success {
					m.update(attempt, DeviceSucceeded, "Codex sign-in completed on this backend host.")
				} else {
					m.update(attempt, DeviceFailed, "Codex sign-in was not completed.")
				}
				return
			}
		}
	}
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		m.update(attempt, DeviceFailed, "Codex device sign-in stream failed.")
	}
}
