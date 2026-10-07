package workspacechat

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// recordingRegistry is a command harness that records the agent of each turn.
type recordingRegistry struct {
	mu    sync.Mutex
	turns []agents.TurnRequest
}

func (r *recordingRegistry) HasProvider(agents.Provider) bool { return true }
func (r *recordingRegistry) ValidateTurnOptions(agents.Provider, agents.TurnRequest) error {
	return nil
}
func (r *recordingRegistry) RunTurn(_ context.Context, _ agents.Provider, req agents.TurnRequest, _ agents.EventHandler) (agents.TurnResult, error) {
	r.mu.Lock()
	r.turns = append(r.turns, req)
	r.mu.Unlock()
	result := agents.TurnResult{Output: "done"}
	if req.Agent != nil {
		result.EffectiveAgentID, result.AgentObservation = req.Agent.ID, agents.AgentApplied
	}
	return result, nil
}

// writeOrchestraAgents creates two global Orchestra agents under home.
func agentCatalogFixture(t *testing.T, database *db.DB, root string) *agentcatalog.Service {
	t.Helper()
	home := t.TempDir()
	dir := filepath.Join(home, ".orchestra", "agents")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, color := range map[string]string{"alpha": "#ff0000", "beta": "#00ff00"} {
		content := "---\nname: " + name + "\ndescription: " + name + " agent\nmode: primary\ncolor: \"" + color + "\"\n---\n\nYou are " + name + ".\n"
		if err := os.WriteFile(filepath.Join(dir, name+".md"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	catalog, err := agentcatalog.New(database, []string{root}, root, map[string]string{"CLAUDE": "claude -p {{prompt}}", "CODEX": "codex exec {{prompt}}"})
	if err != nil {
		t.Fatal(err)
	}
	catalog.SetHome(home)
	return catalog
}

func agentNames(d Detail) []string {
	out := []string{}
	for _, m := range d.Messages {
		out = append(out, m.Role+":"+m.AgentName+":"+m.AgentColor)
	}
	return out
}

func TestAgentSwitchMidChatOnCommandHarness(t *testing.T) {
	root := t.TempDir()
	database, err := db.Connect(filepath.Join(root, "chat.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	pid, err := database.UpsertProject(context.Background(), root, "")
	if err != nil {
		t.Fatal(err)
	}
	r := &recordingRegistry{}
	s, err := New(database, r, []string{root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	s.ConfigureAgentCatalog(agentCatalogFixture(t, database, root))
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "claude", "")
	if err != nil {
		t.Fatal(err)
	}
	for i, id := range []string{"orchestra:global:orchestra:alpha", "orchestra:global:orchestra:beta", ""} {
		if _, err = s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: "m" + string(rune('0'+i)), Text: "hello", RequestedAgentID: id}); err != nil {
			t.Fatalf("send %d: %v", i, err)
		}
		awaitIdle(t, s, pid, sess.ID)
		if i == 1 {
			d, _ := s.Detail(ctx, pid, sess.ID)
			if d.Session.RequestedAgentID != id || d.Session.EffectiveAgentID != id || d.Session.AgentObservation != agents.AgentApplied {
				t.Fatalf("session receipt: %+v", d.Session)
			}
		}
	}
	r.mu.Lock()
	if len(r.turns) != 3 || r.turns[0].Agent == nil || r.turns[0].Agent.Name != "alpha" || r.turns[1].Agent.Name != "beta" || r.turns[1].Agent.Prompt != "You are beta." || r.turns[2].Agent != nil {
		t.Fatalf("each turn must use the agent selected for that message: %+v", r.turns)
	}
	r.mu.Unlock()
	d, err := s.Detail(ctx, pid, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"user:alpha:#ff0000", "assistant:alpha:#ff0000", "user:beta:#00ff00", "assistant:beta:#00ff00", "user::", "assistant::"}
	if strings.Join(agentNames(d), ",") != strings.Join(want, ",") {
		t.Fatalf("per-message agent provenance: %v", agentNames(d))
	}
}

func TestAgentSwitchMidChatOnNativeCodexStartsSeededThread(t *testing.T) {
	s, database, r, pid := nativeFixture(t)
	root := s.roots[0]
	s.ConfigureAgentCatalog(agentCatalogFixture(t, database, root))
	ctx := context.Background()
	sess, err := s.Create(ctx, pid, "codex", "")
	if err != nil {
		t.Fatal(err)
	}
	send := func(id, agent string) {
		t.Helper()
		if _, err := s.Send(ctx, pid, sess.ID, SendRequest{ClientMessageID: id, Text: "msg " + id, RequestedAgentID: agent}); err != nil {
			t.Fatal(err)
		}
		awaitIdle(t, s, pid, sess.ID)
	}
	send("1", "orchestra:global:orchestra:alpha")
	send("2", "orchestra:global:orchestra:alpha")
	r.mu.Lock()
	if len(r.starts) != 1 {
		t.Fatalf("same agent must reuse the native thread: %v", r.starts)
	}
	r.mu.Unlock()
	send("3", "orchestra:global:orchestra:beta")
	r.mu.Lock()
	starts := append([]string(nil), r.starts...)
	n := r.native
	r.mu.Unlock()
	if len(starts) != 2 || starts[1] != "" {
		t.Fatalf("agent switch must start a fresh provider thread: %v", starts)
	}
	n.mu.Lock()
	first := n.texts[0]
	n.mu.Unlock()
	if !strings.Contains(first, "switched this conversation to the beta agent") || !strings.Contains(first, "msg 1") || !strings.HasSuffix(first, "msg 3") {
		t.Fatalf("fresh thread must be seeded with the transcript: %q", first)
	}
	send("4", "orchestra:global:orchestra:beta")
	r.mu.Lock()
	if len(r.starts) != 2 {
		t.Fatalf("unchanged agent must keep the new thread: %v", r.starts)
	}
	r.mu.Unlock()
	n.mu.Lock()
	if n.texts[len(n.texts)-1] != "msg 4" {
		t.Fatalf("resumed turn must not replay: %q", n.texts)
	}
	n.mu.Unlock()
}
