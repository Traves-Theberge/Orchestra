package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/acarl005/stripansi"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/orchestra/orchestra/apps/backend/internal/terminal"
	"github.com/rs/zerolog"
)

func TestTerminalWebSocketRunsInteractiveShell(t *testing.T) {
	manager := terminal.NewManager()
	srv := &Server{logger: zerolog.Nop(), workspaceRoot: t.TempDir(), termManager: manager}
	router := chi.NewRouter()
	router.Get("/terminal/{session_id}", srv.TerminalWebSocket)
	httpServer := httptest.NewServer(router)
	defer httpServer.Close()
	defer manager.CloseSession("ws-e2e")

	url := "ws" + strings.TrimPrefix(httpServer.URL, "http") + "/terminal/ws-e2e"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"resize","rows":30,"cols":100}`)); err != nil {
		t.Fatal(err)
	}
	// Desktop initial commands are sent with a bare "\n".
	if err := conn.WriteMessage(websocket.TextMessage, []byte("echo ws-e2e-$((40+2))\n")); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(defaultShellName()), "cmd") {
		// cmd.exe has no arithmetic expansion; send a plain echo too.
		conn.WriteMessage(websocket.TextMessage, []byte("echo ws-e2e-42\n"))
	}

	var output strings.Builder
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		conn.SetReadDeadline(deadline)
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read: %v; output %q", err, output.String())
		}
		output.Write(data)
		// Matching the computed value proves the shell executed the input
		// rather than merely echoing typed characters.
		if strings.Contains(stripansi.Strip(output.String()), "ws-e2e-42") {
			return
		}
	}
	t.Fatalf("shell output never arrived: %q", output.String())
}

func defaultShellName() string {
	shell, _ := terminal.DefaultShell()
	return shell
}
