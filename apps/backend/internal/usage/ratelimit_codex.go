package usage

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"sync"
	"time"
)

const (
	codexRPCTimeout          = 12 * time.Second
	codexRPCInitMethod       = "initialize"
	codexRPCRateLimitsMethod = "account/rateLimits/read"
	codexInitializedNote     = "initialized"
)

type codexRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      *int        `json:"id,omitempty"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params,omitempty"`
}

type codexRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int            `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type codexRPCWindow struct {
	UsedPercent        *float64 `json:"usedPercent"`
	WindowDurationMins *int     `json:"windowDurationMins"`
	ResetsAt           *int64   `json:"resetsAt"` // Codex emits unix seconds.
}

type codexRPCRateLimits struct {
	Primary   *codexRPCWindow `json:"primary"`
	Secondary *codexRPCWindow `json:"secondary"`
}

type codexRPCRateLimitsWrapper struct {
	RateLimits *codexRPCRateLimits `json:"rateLimits"`
}

func mapCodexWindow(w *codexRPCWindow, defaultMinutes int) *RateLimitWindow {
	if w == nil || w.UsedPercent == nil {
		return nil
	}
	pct := *w.UsedPercent
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	mins := defaultMinutes
	if w.WindowDurationMins != nil && *w.WindowDurationMins > 0 {
		mins = *w.WindowDurationMins
	}
	out := &RateLimitWindow{UsedPercent: pct, WindowMinutes: mins}
	if w.ResetsAt != nil && *w.ResetsAt > 0 {
		t := time.Unix(*w.ResetsAt, 0)
		ms := t.UnixMilli()
		out.ResetsAt = &ms
		out.ResetDescription = formatResetDescription(t)
	}
	return out
}

// fetchCodexRateLimits drives the Codex CLI's `app-server` JSON-RPC mode to
// read account rate limits. Mirrors Orca's codex-fetcher: initialize →
// initialized notification → account/rateLimits/read.
func fetchCodexRateLimits(ctx context.Context) *ProviderRateLimits {
	now := time.Now().UnixMilli()
	if _, err := exec.LookPath("codex"); err != nil {
		return &ProviderRateLimits{
			Provider: ProviderCodex, Status: RateLimitUnavailable, UpdatedAt: now,
			Error: "Codex CLI not found on PATH",
		}
	}

	cctx, cancel := context.WithTimeout(ctx, codexRPCTimeout)
	defer cancel()

	cmd := exec.CommandContext(cctx, "codex", "-s", "read-only", "-a", "untrusted", "app-server")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return errResult(now, err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return errResult(now, err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return errResult(now, err)
	}
	if err := cmd.Start(); err != nil {
		return errResult(now, err)
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	}()

	// Drain stderr so the child doesn't block; we only surface it on failure.
	var stderrBuf []byte
	var stderrMu sync.Mutex
	go func() {
		b, _ := io.ReadAll(stderr)
		stderrMu.Lock()
		stderrBuf = b
		stderrMu.Unlock()
	}()

	enc := json.NewEncoder(stdin)
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)

	send := func(req codexRPCRequest) error {
		req.JSONRPC = "2.0"
		return enc.Encode(req)
	}

	initID := 1
	if err := send(codexRPCRequest{
		ID:     &initID,
		Method: codexRPCInitMethod,
		Params: map[string]any{"clientInfo": map[string]string{"name": "orchestra", "version": "1.0.0"}},
	}); err != nil {
		return errResult(now, err)
	}

	rateID := 2
	rateSent := false

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var msg codexRPCResponse
		if err := json.Unmarshal(line, &msg); err != nil {
			continue // non-JSON noise
		}
		if msg.ID == nil {
			continue // server-initiated notification
		}
		if *msg.ID == initID {
			if msg.Error != nil {
				return errResult(now, fmt.Errorf("codex initialize: %s", msg.Error.Message))
			}
			// Send initialized notification, then request rate limits.
			if err := send(codexRPCRequest{Method: codexInitializedNote, Params: map[string]any{}}); err != nil {
				return errResult(now, err)
			}
			if err := send(codexRPCRequest{ID: &rateID, Method: codexRPCRateLimitsMethod, Params: map[string]any{}}); err != nil {
				return errResult(now, err)
			}
			rateSent = true
			continue
		}
		if rateSent && *msg.ID == rateID {
			if msg.Error != nil {
				return errResult(now, fmt.Errorf("rateLimits: %s", msg.Error.Message))
			}
			var wrapper codexRPCRateLimitsWrapper
			if err := json.Unmarshal(msg.Result, &wrapper); err != nil {
				return errResult(now, err)
			}
			session, weekly := classifyCodexWindows(wrapper.RateLimits)
			return &ProviderRateLimits{
				Provider:  ProviderCodex,
				Session:   session,
				Weekly:    weekly,
				UpdatedAt: time.Now().UnixMilli(),
				Status:    RateLimitOK,
			}
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		return errResult(now, err)
	}
	stderrMu.Lock()
	stderrPreview := string(stderrBuf)
	stderrMu.Unlock()
	if cctx.Err() == context.DeadlineExceeded {
		return errResult(now, fmt.Errorf("codex app-server RPC timed out"))
	}
	if stderrPreview != "" {
		return errResult(now, fmt.Errorf("codex app-server exited: %s", trimPreview(stderrPreview)))
	}
	return errResult(now, fmt.Errorf("codex app-server closed before responding"))
}

// classifyCodexWindows dispatches the two RPC slots into our session/weekly
// fields by their reported windowDurationMins, since Codex returns "primary"
// for whichever window is currently most relevant — on free plans that's the
// weekly window with primary.windowDurationMins=10080 and secondary=null.
func classifyCodexWindows(l *codexRPCRateLimits) (session, weekly *RateLimitWindow) {
	if l == nil {
		return nil, nil
	}
	classify := func(w *codexRPCWindow) {
		if w == nil {
			return
		}
		mins := 0
		if w.WindowDurationMins != nil {
			mins = *w.WindowDurationMins
		}
		if mins >= 1440 { // 24h or longer → weekly slot
			if weekly == nil {
				weekly = mapCodexWindow(w, 10080)
			}
			return
		}
		if session == nil {
			session = mapCodexWindow(w, 300)
		}
	}
	classify(l.Primary)
	classify(l.Secondary)
	return session, weekly
}

func errResult(now int64, err error) *ProviderRateLimits {
	return &ProviderRateLimits{
		Provider:  ProviderCodex,
		Status:    RateLimitErrored,
		UpdatedAt: now,
		Error:     err.Error(),
	}
}

func trimPreview(s string) string {
	const max = 200
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
