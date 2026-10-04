package agents

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type acpFixturePeer struct {
	conn    net.Conn
	scanner *bufio.Scanner
}

func (p *acpFixturePeer) read() (antigravityACPWire, error) {
	var wire antigravityACPWire
	if !p.scanner.Scan() {
		return wire, io.EOF
	}
	return wire, json.Unmarshal(p.scanner.Bytes(), &wire)
}
func (p *acpFixturePeer) send(value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = p.conn.Write(append(data, '\n'))
	return err
}
func (p *acpFixturePeer) result(request antigravityACPWire, value any) error {
	return p.send(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": value})
}
func (p *acpFixturePeer) request(method string) (antigravityACPWire, error) {
	wire, err := p.read()
	if err != nil {
		return wire, err
	}
	if wire.Method != method {
		return wire, fmt.Errorf("wanted %s, got %s", method, wire.Method)
	}
	return wire, nil
}

func newACPFixture(t *testing.T, handlers AntigravityACPHandlers, script func(*acpFixturePeer) error) *AntigravityACPClient {
	t.Helper()
	local, remote := net.Pipe()
	client := NewAntigravityACPClient(local, handlers)
	done := make(chan error, 1)
	go func() { defer remote.Close(); done <- script(&acpFixturePeer{remote, bufio.NewScanner(remote)}) }()
	t.Cleanup(func() {
		client.Close()
		remote.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("fake ACP peer: %v", err)
			}
		case <-time.After(time.Second):
			t.Error("fake ACP peer leaked")
		}
	})
	return client
}

func acpFixtureContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func acpFixtureInitialize(peer *acpFixturePeer, load, resume bool) error {
	request, err := peer.request("initialize")
	if err != nil {
		return err
	}
	var params struct {
		ProtocolVersion int            `json:"protocolVersion"`
		Capabilities    map[string]any `json:"clientCapabilities"`
	}
	if json.Unmarshal(request.Params, &params) != nil || params.ProtocolVersion != 1 || len(params.Capabilities) != 0 {
		return errors.New("client advertised unimplemented capabilities")
	}
	caps := map[string]any{"loadSession": load}
	if resume {
		caps["sessionCapabilities"] = map[string]any{"resume": map[string]any{}}
	}
	return peer.result(request, map[string]any{"protocolVersion": 1, "agentCapabilities": caps, "authMethods": []any{}})
}
func acpFixtureSession(peer *acpFixturePeer) error {
	if err := acpFixtureInitialize(peer, true, true); err != nil {
		return err
	}
	request, err := peer.request("session/new")
	if err != nil {
		return err
	}
	return peer.result(request, map[string]any{"sessionId": "session-fixture"})
}
func openACPFixture(t *testing.T, client *AntigravityACPClient) context.Context {
	t.Helper()
	ctx := acpFixtureContext(t)
	if _, err := client.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.OpenSession(ctx, "new", filepath.Join(t.TempDir(), "workspace"), ""); err != nil {
		t.Fatal(err)
	}
	return ctx
}

func TestAntigravityACPRealIOTextPermissionQuestionAndUnsupportedMethod(t *testing.T) {
	var updates []AntigravityACPUpdate
	var questions []bool
	client := newACPFixture(t, AntigravityACPHandlers{
		OnUpdate: func(update AntigravityACPUpdate) { updates = append(updates, update) },
		Permission: func(_ context.Context, p AntigravityACPPermission) (AntigravityACPDecision, error) {
			questions = append(questions, p.IsQuestion())
			return AntigravityACPDecision{OptionID: p.Options[0].ID}, nil
		},
	}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		request, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if !strings.Contains(string(request.Params), `"sessionId":"session-fixture"`) {
			return errors.New("lost prompt session")
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "hello"}}}}); err != nil {
			return err
		}
		for i, toolID := range []string{"interaction_fixture", "command_fixture"} {
			if err := peer.send(map[string]any{"jsonrpc": "2.0", "id": i + 10, "method": "session/request_permission", "params": map[string]any{"sessionId": "session-fixture", "toolCall": map[string]string{"toolCallId": toolID}, "options": []any{map[string]string{"optionId": " opaque choice ", "name": "Fixture", "kind": "allow_once"}}}}); err != nil {
				return err
			}
			reply, err := peer.read()
			if err != nil {
				return err
			}
			var selected struct {
				Outcome struct {
					Kind string `json:"outcome"`
					ID   string `json:"optionId"`
				} `json:"outcome"`
			}
			if json.Unmarshal(reply.Result, &selected) != nil || selected.Outcome.Kind != "selected" || selected.Outcome.ID != " opaque choice " {
				return errors.New("lost offered opaque choice")
			}
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "id": "unimplemented-fs", "method": "fs/write_text_file", "params": map[string]any{}}); err != nil {
			return err
		}
		reply, err := peer.read()
		if err != nil {
			return err
		}
		if reply.Error == nil || reply.Error.Code != -32601 {
			return errors.New("unsupported client method fabricated success")
		}
		return peer.result(request, map[string]string{"stopReason": "end_turn"})
	})
	ctx := openACPFixture(t, client)
	result, err := client.Prompt(ctx, "hello fixture")
	if err != nil {
		t.Fatal(err)
	}
	if result.StopReason != "end_turn" || result.CancellationObserved || len(updates) != 1 || len(questions) != 2 || !questions[0] || questions[1] {
		t.Fatalf("wrong observed events/result: %+v %+v %+v", result, updates, questions)
	}
}

func TestAntigravityACPExplicitRestoreWithReplayAndCapabilityGates(t *testing.T) {
	for _, method := range []string{"load", "resume"} {
		t.Run(method, func(t *testing.T) {
			updates := 0
			client := newACPFixture(t, AntigravityACPHandlers{OnUpdate: func(AntigravityACPUpdate) { updates++ }}, func(peer *acpFixturePeer) error {
				if err := acpFixtureInitialize(peer, true, true); err != nil {
					return err
				}
				request, err := peer.request("session/" + method)
				if err != nil {
					return err
				}
				if !strings.Contains(string(request.Params), `"sessionId":"persisted-session"`) {
					return errors.New("restore omitted exact identity")
				}
				if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "persisted-session", "update": map[string]any{"sessionUpdate": "user_message_chunk", "content": map[string]string{"type": "text", "text": "history"}}}}); err != nil {
					return err
				}
				return peer.result(request, map[string]any{}) // Load/resume need not repeat sessionId.
			})
			ctx := acpFixtureContext(t)
			if _, err := client.Initialize(ctx); err != nil {
				t.Fatal(err)
			}
			id, err := client.OpenSession(ctx, method, t.TempDir(), "persisted-session")
			if err != nil {
				t.Fatal(err)
			}
			if id != "persisted-session" || updates != 1 {
				t.Fatal("lost restored binding or replay")
			}
		})
	}
	client := newACPFixture(t, AntigravityACPHandlers{}, func(peer *acpFixturePeer) error {
		if err := acpFixtureInitialize(peer, false, false); err != nil {
			return err
		}
		_, err := peer.read()
		if err != io.EOF {
			return errors.New("unsupported restore wrote a request")
		}
		return nil
	})
	ctx := acpFixtureContext(t)
	if _, err := client.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"load", "resume"} {
		if _, err := client.OpenSession(ctx, method, t.TempDir(), "saved"); err == nil {
			t.Fatal("accepted absent restore capability")
		}
	}
}

func TestAntigravityACPCancelWaitsForTerminalAndCancelsPendingPermission(t *testing.T) {
	permissionStarted := make(chan struct{})
	client := newACPFixture(t, AntigravityACPHandlers{Permission: func(ctx context.Context, _ AntigravityACPPermission) (AntigravityACPDecision, error) {
		close(permissionStarted)
		<-ctx.Done()
		return AntigravityACPDecision{}, ctx.Err()
	}}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		request, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "id": "pending-permission", "method": "session/request_permission", "params": map[string]any{"sessionId": "session-fixture", "toolCall": map[string]string{"toolCallId": "command"}, "options": []any{map[string]string{"optionId": "allow", "kind": "allow_once"}}}}); err != nil {
			return err
		}
		notified, permissionCancelled := false, false
		for i := 0; i < 2; i++ {
			wire, err := peer.read()
			if err != nil {
				return err
			}
			if wire.Method == "session/cancel" {
				notified = true
				if wire.ID != nil {
					return errors.New("cancel must be notification")
				}
			} else {
				permissionCancelled = strings.Contains(string(wire.Result), `"outcome":"cancelled"`)
			}
		}
		if !notified || !permissionCancelled {
			return errors.New("cancel did not resolve pending permission")
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": "command", "status": "completed"}}}); err != nil {
			return err
		}
		return peer.result(request, map[string]string{"stopReason": "cancelled"})
	})
	ctx := openACPFixture(t, client)
	type completion struct {
		result AntigravityACPPromptResult
		err    error
	}
	done := make(chan completion, 1)
	go func() { result, err := client.Prompt(ctx, "permission fixture"); done <- completion{result, err} }()
	select {
	case <-permissionStarted:
	case <-ctx.Done():
		t.Fatal("permission never arrived")
	}
	if err := client.Cancel(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case terminal := <-done:
		if terminal.err != nil || !terminal.result.CancelRequested || !terminal.result.CancellationObserved {
			t.Fatalf("cancel unconfirmed: %+v", terminal)
		}
	case <-ctx.Done():
		t.Fatal("cancel settlement timed out")
	}
}

func TestAntigravityACPLossUnknownResponseAndUnsupportedVersion(t *testing.T) {
	for _, scenario := range []string{"loss", "unknown response", "unsupported version", "malformed"} {
		t.Run(scenario, func(t *testing.T) {
			client := newACPFixture(t, AntigravityACPHandlers{}, func(peer *acpFixturePeer) error {
				request, err := peer.request("initialize")
				if err != nil {
					return err
				}
				switch scenario {
				case "loss":
					return nil
				case "unknown response":
					return peer.send(map[string]any{"jsonrpc": "2.0", "id": "other-request", "result": map[string]any{"protocolVersion": 1}})
				case "unsupported version":
					return peer.result(request, map[string]any{"protocolVersion": 2})
				default:
					_, err = peer.conn.Write([]byte("invalid json\n"))
					return err
				}
			})
			ctx := acpFixtureContext(t)
			if _, err := client.Initialize(ctx); err == nil {
				t.Fatal("accepted bad/lost peer")
			}
			if _, err := client.Initialize(ctx); err == nil {
				t.Fatal("reused failed connection")
			}
		})
	}
}

func TestAntigravityACPDuplicateResponseAndWrongSessionUpdate(t *testing.T) {
	for _, scenario := range []string{"duplicate response", "wrong session", "unoffered decision", "unsupported update"} {
		t.Run(scenario, func(t *testing.T) {
			client := newACPFixture(t, AntigravityACPHandlers{Permission: func(context.Context, AntigravityACPPermission) (AntigravityACPDecision, error) {
				return AntigravityACPDecision{OptionID: "invented"}, nil
			}}, func(peer *acpFixturePeer) error {
				if err := acpFixtureInitialize(peer, true, true); err != nil {
					return err
				}
				newRequest, err := peer.request("session/new")
				if err != nil {
					return err
				}
				if err := peer.result(newRequest, map[string]string{"sessionId": "session-fixture"}); err != nil {
					return err
				}
				if _, err := peer.request("session/prompt"); err != nil {
					return err
				}
				switch scenario {
				case "duplicate response":
					return peer.result(newRequest, map[string]string{"sessionId": "session-fixture"})
				case "wrong session":
					return peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "other-session", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "wrong"}}}})
				case "unsupported update":
					return peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]string{"sessionUpdate": "future_update"}}})
				default:
					return peer.send(map[string]any{"jsonrpc": "2.0", "id": "question", "method": "session/request_permission", "params": map[string]any{"sessionId": "session-fixture", "toolCall": map[string]string{"toolCallId": "interaction_test"}, "options": []any{map[string]string{"optionId": "offered", "kind": "allow_once"}}}})
				}
			})
			ctx := openACPFixture(t, client)
			if _, err := client.Prompt(ctx, "fixture"); err == nil {
				t.Fatal("accepted stale or unsupported peer message")
			}
		})
	}
}

func TestAntigravityACPDeadlineRetiresTransportWithoutReplay(t *testing.T) {
	client := newACPFixture(t, AntigravityACPHandlers{}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		if _, err := peer.request("session/prompt"); err != nil {
			return err
		}
		_, err := peer.read()
		if err != io.EOF {
			return errors.New("interrupted request replayed or transport left open")
		}
		return nil
	})
	openACPFixture(t, client)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	result, err := client.Prompt(ctx, "lost prompt")
	if err == nil || result.CancellationObserved {
		t.Fatal("deadline manufactured cancellation settlement")
	}
	if _, err := client.Prompt(context.Background(), "replay"); err == nil {
		t.Fatal("automatically reused disconnected client")
	}
}

func TestAntigravityACPCancelCannotPrecedePromptDispatch(t *testing.T) {
	allowPromptRead := make(chan struct{})
	client := newACPFixture(t, AntigravityACPHandlers{}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		<-allowPromptRead
		request, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		return peer.result(request, map[string]string{"stopReason": "end_turn"})
	})
	ctx := openACPFixture(t, client)
	done := make(chan error, 1)
	go func() { _, err := client.Prompt(ctx, "fixture"); done <- err }()
	// The peer deliberately has not read the prompt, so net.Pipe keeps the
	// outbound request blocked. Cancel must never reach the peer first.
	for {
		client.mu.Lock()
		prompting := client.prompting
		client.mu.Unlock()
		if prompting {
			break
		}
		select {
		case <-ctx.Done():
			close(allowPromptRead)
			t.Fatal("prompt did not start")
		case <-time.After(time.Millisecond):
		}
	}
	if err := client.Cancel(ctx); err == nil {
		close(allowPromptRead)
		t.Fatal("cancel accepted before prompt dispatch")
	}
	close(allowPromptRead)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("prompt did not settle")
	}
}

func TestAntigravityACPCancelWithoutTerminalRemainsUnconfirmed(t *testing.T) {
	ready := make(chan struct{})
	client := newACPFixture(t, AntigravityACPHandlers{OnUpdate: func(AntigravityACPUpdate) { close(ready) }}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		if _, err := peer.request("session/prompt"); err != nil {
			return err
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "active"}}}}); err != nil {
			return err
		}
		_, err := peer.request("session/cancel")
		return err // The peer exits without settling the prompt.
	})
	ctx := openACPFixture(t, client)
	type completion struct {
		result AntigravityACPPromptResult
		err    error
	}
	done := make(chan completion, 1)
	go func() { result, err := client.Prompt(ctx, "fixture"); done <- completion{result, err} }()
	select {
	case <-ready:
	case <-ctx.Done():
		t.Fatal("prompt not observed")
	}
	if err := client.Cancel(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case terminal := <-done:
		if terminal.err == nil || !terminal.result.CancelRequested || terminal.result.CancellationObserved {
			t.Fatalf("manufactured cancellation: %+v", terminal)
		}
	case <-ctx.Done():
		t.Fatal("lost peer did not settle transport")
	}
}

func TestAntigravityACPDelayedCancelCannotTargetReplacementPrompt(t *testing.T) {
	ready := make(chan struct{})
	client := newACPFixture(t, AntigravityACPHandlers{OnUpdate: func(AntigravityACPUpdate) { close(ready) }}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		first, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if err := peer.result(first, map[string]string{"stopReason": "end_turn"}); err != nil {
			return err
		}
		second, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "replacement active"}}}}); err != nil {
			return err
		}
		if _, err := peer.request("session/cancel"); err != nil {
			return err
		}
		return peer.result(second, map[string]string{"stopReason": "cancelled"})
	})
	ctx := openACPFixture(t, client)
	if _, err := client.Prompt(ctx, "first"); err != nil {
		t.Fatal(err)
	}
	client.mu.Lock()
	oldGeneration, sessionID := client.promptGeneration, client.sessionID
	client.mu.Unlock()
	done := make(chan error, 1)
	go func() { _, err := client.Prompt(ctx, "replacement"); done <- err }()
	select {
	case <-ready:
	case <-ctx.Done():
		t.Fatal("replacement not observed")
	}
	// Reproduce a Cancel snapshot delayed while waiting for writeMu. Exercise
	// its actual write/fence stage after the replacement is already on the wire.
	if err := client.cancelPrompt(ctx, sessionID, oldGeneration); err == nil {
		t.Fatal("delayed cancel targeted replacement")
	}
	if err := client.Cancel(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("replacement did not settle")
	}
}

func TestAntigravityACPCloseCancelsBlockedPermissionHandler(t *testing.T) {
	permissionStarted := make(chan struct{})
	client := newACPFixture(t, AntigravityACPHandlers{Permission: func(ctx context.Context, _ AntigravityACPPermission) (AntigravityACPDecision, error) {
		close(permissionStarted)
		<-ctx.Done()
		return AntigravityACPDecision{}, ctx.Err()
	}}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		if _, err := peer.request("session/prompt"); err != nil {
			return err
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "id": "blocked-permission", "method": "session/request_permission", "params": map[string]any{"sessionId": "session-fixture", "toolCall": map[string]string{"toolCallId": "command"}, "options": []any{map[string]string{"optionId": "allow", "kind": "allow_once"}}}}); err != nil {
			return err
		}
		_, err := peer.read()
		if err != io.EOF {
			return fmt.Errorf("closed transport still active: %v", err)
		}
		return nil
	})
	openACPFixture(t, client)
	done := make(chan error, 1)
	go func() { _, err := client.Prompt(context.Background(), "blocked approval"); done <- err }()
	select {
	case <-permissionStarted:
	case <-time.After(time.Second):
		t.Fatal("permission callback did not start")
	}
	_ = client.Close()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Close fabricated prompt success")
		}
	case <-time.After(time.Second):
		t.Fatal("Close left permission callback and Prompt blocked")
	}
}

func TestAntigravityACPQueuedDeadlineDoesNotDispatchOrRetireActiveTurn(t *testing.T) {
	active := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	client := newACPFixture(t, AntigravityACPHandlers{OnUpdate: func(AntigravityACPUpdate) { close(active) }}, func(peer *acpFixturePeer) error {
		if err := acpFixtureSession(peer); err != nil {
			return err
		}
		first, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if err := peer.send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "session-fixture", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]string{"type": "text", "text": "first active"}}}}); err != nil {
			return err
		}
		<-release
		if err := peer.result(first, map[string]string{"stopReason": "end_turn"}); err != nil {
			return err
		}
		third, err := peer.request("session/prompt")
		if err != nil {
			return err
		}
		if strings.Contains(string(third.Params), "queued expired") {
			return errors.New("expired queued prompt reached peer")
		}
		return peer.result(third, map[string]string{"stopReason": "end_turn"})
	})
	t.Cleanup(unblock)
	openACPFixture(t, client)
	firstDone := make(chan error, 1)
	go func() { _, err := client.Prompt(context.Background(), "first"); firstDone <- err }()
	select {
	case <-active:
	case <-time.After(time.Second):
		unblock()
		t.Fatal("active prompt never started")
	}
	queuedCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	queuedDone := make(chan error, 1)
	go func() { _, err := client.Prompt(queuedCtx, "queued expired"); queuedDone <- err }()
	select {
	case err := <-queuedDone:
		if !errors.Is(err, context.DeadlineExceeded) {
			unblock()
			t.Fatalf("wrong admission error: %v", err)
		}
	case <-time.After(time.Second):
		unblock()
		t.Fatal("queued deadline ignored behind active prompt")
	}
	unblock()
	select {
	case err := <-firstDone:
		if err != nil {
			t.Fatalf("queued expiry retired active connection: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("active prompt did not finish")
	}
	if _, err := client.Prompt(acpFixtureContext(t), "third valid"); err != nil {
		t.Fatalf("connection unusable after queued expiry: %v", err)
	}
}
