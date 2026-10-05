package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

func TestTrackerFactoryRequiresNativeLinearAndJiraScopes(t *testing.T) {
	factory := buildTrackerAdapterFactory(nil)
	if _, err := factory(&db.TrackerConfig{Type: "linear", Endpoint: "https://api.linear.app/graphql"}, "token"); err == nil {
		t.Fatal("Linear config without a team key was accepted")
	}
	if _, err := factory(&db.TrackerConfig{Type: "jira", Endpoint: "https://jira.example"}, "token"); err == nil {
		t.Fatal("Jira config without default_project was accepted")
	}
	if _, err := factory(&db.TrackerConfig{Type: "linear", Endpoint: "https://api.linear.app/graphql", Extra: `{"team_key":"ENG"}`}, "token"); err != nil {
		t.Fatalf("valid Linear team scope rejected: %v", err)
	}
	if _, err := factory(&db.TrackerConfig{Type: "jira", Endpoint: "https://jira.example", Extra: `{"default_project":"PROJ","jira_user":"service-user"}`}, "token"); err != nil {
		t.Fatalf("valid Jira project scope rejected: %v", err)
	}
	if _, err := factory(&db.TrackerConfig{Type: "jira", Endpoint: "https://jira.example", Extra: `{"default_project":"PROJ"}`}, "token"); err == nil || !strings.Contains(err.Error(), "extra.jira_user") {
		t.Fatalf("Jira Server without username error = %v, want actionable extra.jira_user requirement", err)
	}
	if _, err := factory(&db.TrackerConfig{Type: "jira", Endpoint: "https://acme.atlassian.net", Extra: `{"default_project":"PROJ"}`}, "token"); err != nil {
		t.Fatalf("Cloud Jira with intentional empty-user Bearer credential rejected: %v", err)
	}
}

func TestTrackerFactoryUsesJiraServerUsername(t *testing.T) {
	var gotUser, gotPassword string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, gotPassword, _ = r.BasicAuth()
		_ = json.NewEncoder(w).Encode(map[string]string{"name": "fixture-user"})
	}))
	defer server.Close()
	factory := buildTrackerAdapterFactory(nil)
	adapter, err := factory(&db.TrackerConfig{Type: "jira", Endpoint: server.URL, Extra: `{"default_project":"PROJ","jira_user":"service-user"}`}, "fixture-pat")
	if err != nil {
		t.Fatalf("create adapter: %v", err)
	}
	if err := adapter.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	if gotUser != "service-user" || gotPassword != "fixture-pat" {
		t.Fatalf("Jira Server Basic auth = %q/%q, want service-user/fixture-pat", gotUser, gotPassword)
	}
}
