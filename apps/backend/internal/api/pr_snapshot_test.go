package api

import (
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestGetPRSnapshotHTTP(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(fmt.Sprint(changed), func(t *testing.T) {
			warehouse, err := db.Connect(filepath.Join(t.TempDir(), "snapshot.db"))
			if err != nil {
				t.Fatal(err)
			}
			defer warehouse.Close()
			id, err := warehouse.UpsertProject(t.Context(), t.TempDir(), "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := warehouse.Exec("UPDATE projects SET github_owner=?,github_repo=?,github_token=? WHERE id=?", "owner", "repo", "fixture-token", id); err != nil {
				t.Fatal(err)
			}
			base, head := strings.Repeat("a", 40), strings.Repeat("b", 40)
			var calls atomic.Int32
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				call := calls.Add(1)
				if call == 2 {
					if r.URL.Path != "/repos/owner/repo/compare/"+base+"..."+head {
						t.Errorf("wrong pinned diff: %s", r.URL)
					}
					fmt.Fprint(w, "diff --git a/file b/file\n+pinned")
					return
				}
				if r.URL.Path != "/repos/owner/repo/pulls/7" {
					t.Errorf("wrong PR: %s", r.URL)
				}
				returnedHead := head
				if call == 3 && changed {
					returnedHead = strings.Repeat("c", 40)
				}
				fmt.Fprintf(w, `{"number":7,"state":"open","head":{"sha":%q},"base":{"sha":%q}}`, returnedHead, base)
			}))
			defer fixture.Close()
			target, _ := url.Parse(fixture.URL)
			previous := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: &mergeAPIFixtureTransport{target: target}}
			t.Cleanup(func() { http.DefaultClient = previous })
			orch := orchestrator.NewService()
			orch.SetDB(warehouse)
			router := NewRouterWithPubSub(zerolog.Nop(), orch, &config.Config{Host: "127.0.0.1"}, nil, warehouse, nil, nil, nil, nil, nil)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1/projects/"+id+"/github/pulls/7/snapshot", nil))
			want := 200
			if changed {
				want = 409
			}
			if response.Code != want {
				t.Fatalf("got %d: %s", response.Code, response.Body.String())
			}
			if !changed && (!strings.Contains(response.Body.String(), head) || !strings.Contains(response.Body.String(), "pinned")) {
				t.Fatalf("snapshot missing: %s", response.Body.String())
			}
		})
	}
}
