package harnesssetup

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"
)

func init() {
	if os.Getenv("ORCHESTRA_FAKE_CODEX_APP_SERVER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		os.Exit(2)
	}
	if !fakeRPCMethod(scanner.Bytes(), "initialize", true) {
		os.Exit(2)
	}
	fmt.Println(`{"jsonrpc":"2.0","id":1,"result":{}}`)
	if !scanner.Scan() {
		os.Exit(2)
	} // initialized notification
	if !fakeRPCMethod(scanner.Bytes(), "initialized", false) {
		os.Exit(2)
	}
	if !scanner.Scan() {
		os.Exit(2)
	} // account/login/start
	if !fakeRPCMethod(scanner.Bytes(), "account/login/start", true) {
		os.Exit(2)
	}
	fmt.Println(`{"jsonrpc":"2.0","id":2,"result":{"type":"chatgptDeviceCode","loginId":"login-1","userCode":"TEST-CODE","verificationUrl":"https://auth.openai.com/device"}}`)
	time.Sleep(100 * time.Millisecond)
	fmt.Println(`{"jsonrpc":"2.0","method":"account/login/completed","params":{"loginId":"login-1","success":true}}`)
	os.Exit(0)
}

func fakeRPCMethod(line []byte, method string, withID bool) bool {
	var request struct {
		Method string          `json:"method"`
		ID     *int            `json:"id"`
		Params json.RawMessage `json:"params"`
	}
	if json.Unmarshal(line, &request) != nil || request.Method != method || (request.ID != nil) != withID {
		return false
	}
	if method == "account/login/start" {
		var params struct {
			Type string `json:"type"`
		}
		return json.Unmarshal(request.Params, &params) == nil && params.Type == "chatgptDeviceCode"
	}
	return true
}

func TestDeviceLoginCancelKeepsTerminalState(t *testing.T) {
	manager := NewDeviceLoginManager()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	attempt := &deviceAttempt{snapshot: DeviceLoginSnapshot{ID: "one", State: DevicePending}, cancel: cancel, ready: make(chan struct{})}
	manager.current = attempt
	if !manager.Cancel("one") {
		t.Fatal("active login was not canceled")
	}
	if snapshot, found := manager.Get("one"); !found || snapshot.State != DeviceCanceled {
		t.Fatalf("canceled snapshot = %+v, found=%t", snapshot, found)
	}
	manager.update(attempt, DeviceSucceeded, "late completion")
	if snapshot, _ := manager.Get("one"); snapshot.State != DeviceCanceled {
		t.Fatal("late completion revived a canceled login")
	}
	if _, found := manager.Get("another"); found {
		t.Fatal("a different login ID resolved")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("login subprocess context was not canceled")
	}
}

func TestDeviceLoginAppServerProtocol(t *testing.T) {
	t.Setenv("ORCHESTRA_FAKE_CODEX_APP_SERVER", "1")
	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	manager := NewDeviceLoginManager()
	snapshot, err := manager.Start(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.UserCode != "TEST-CODE" || snapshot.VerificationURL != "https://auth.openai.com/device" {
		t.Fatalf("device response = %+v", snapshot)
	}
	deadline := time.After(3 * time.Second)
	for {
		current, found := manager.Get(snapshot.ID)
		if !found {
			t.Fatal("login disappeared")
		}
		if current.State == DeviceSucceeded {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("login did not complete: %+v", current)
		case <-time.After(20 * time.Millisecond):
		}
	}
}
