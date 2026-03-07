package graphql

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestFetchIssueStatesByIDsChunksRequests(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		response := map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "issue-1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	ids := make([]string, 0, 120)
	for i := 0; i < 120; i++ {
		ids = append(ids, "issue-")
	}

	_, err := client.FetchIssueStatesByIDs(context.Background(), ids)
	if err != nil {
		t.Fatalf("fetch states: %v", err)
	}
	if atomic.LoadInt32(&calls) != 3 {
		t.Fatalf("expected 3 chunked requests, got %d", calls)
	}
}

func TestFetchIssuesByIDsReturnsIssuePayloads(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"id":               "1",
						"identifier":       "ORC-1",
						"title":            "a",
						"state":            map[string]any{"name": "In Progress"},
						"assignee":         map[string]any{"id": "user-1"},
						"labels":           map[string]any{"nodes": []map[string]any{{"name": "BackEnd"}}},
						"inverseRelations": map[string]any{"nodes": []map[string]any{{"type": "blocks", "issue": map[string]any{"id": "B-1", "identifier": "ORC-B1", "state": map[string]any{"name": "Todo"}}}}},
					}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"1"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %d", len(issues))
	}
	if issues[0].Identifier != "ORC-1" || issues[0].State != "In Progress" {
		t.Fatalf("unexpected issue payload: %+v", issues[0])
	}
	if len(issues[0].BlockedBy) != 1 || issues[0].BlockedBy[0].Identifier != "ORC-B1" {
		t.Fatalf("unexpected blocker payload: %+v", issues[0].BlockedBy)
	}
}

func TestFetchIssuesByIDsPaginates(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Todo"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"1", "2"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues from paginated responses, got %d", len(issues))
	}
}

func TestFetchIssuesByIDsDeduplicatesAcrossPages(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "duplicate", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"1"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected duplicate issue to be collapsed, got %d", len(issues))
	}
}

func TestFetchIssuesByIDsPreservesInputOrderAcrossPages(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Todo"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	issues, err := client.FetchIssuesByIDs(context.Background(), []string{"1", "2"})
	if err != nil {
		t.Fatalf("fetch issues by ids: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}
	if issues[0].ID != "1" || issues[1].ID != "2" {
		t.Fatalf("expected input order [1,2], got [%s,%s]", issues[0].ID, issues[1].ID)
	}
}

func TestFetchIssuesByIDsErrorsWhenNextPageCursorMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": true, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	_, err := client.FetchIssuesByIDs(context.Background(), []string{"1"})
	if err == nil {
		t.Fatalf("expected missing end cursor error")
	}
	if !strings.Contains(err.Error(), "missing end cursor") {
		t.Fatalf("expected missing end cursor detail, got %v", err)
	}
}

func TestFetchIssueStatesByIDsPaginatesWithinChunk(t *testing.T) {
	var page int32
	var sawAfter bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var requestBody map[string]any
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		variables, _ := requestBody["variables"].(map[string]any)

		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			if _, ok := variables["after"]; ok {
				t.Fatalf("did not expect after on first page")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "issue-1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}

		if variables["after"] == "cursor-1" {
			sawAfter = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "issue-2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	states, err := client.FetchIssueStatesByIDs(context.Background(), []string{"issue-1", "issue-2"})
	if err != nil {
		t.Fatalf("fetch states: %v", err)
	}
	if !sawAfter {
		t.Fatalf("expected pagination request to include after cursor")
	}
	if states["issue-1"] != "In Progress" || states["issue-2"] != "Done" {
		t.Fatalf("unexpected merged states: %+v", states)
	}
}

func TestFetchIssueStatesByIDsErrorsWhenNextPageCursorMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "issue-1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": true, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	_, err := client.FetchIssueStatesByIDs(context.Background(), []string{"issue-1"})
	if err == nil {
		t.Fatalf("expected missing end cursor error")
	}
	if !strings.Contains(err.Error(), "missing end cursor") {
		t.Fatalf("expected missing end cursor detail, got %v", err)
	}
}

func TestFetchIssuesByStatesPaginates(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Done"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err != nil {
		t.Fatalf("fetch by states: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues from paginated responses, got %d", len(issues))
	}
}

func TestFetchIssuesByStatesDeduplicatesAcrossPages(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Done"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "duplicate", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err != nil {
		t.Fatalf("fetch by states: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected duplicate issue to be collapsed, got %d", len(issues))
	}
}

func TestFetchIssuesByStatesSortsDeterministically(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-20", "title": "later", "state": map[string]any{"name": "Done"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-10", "title": "earlier", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err != nil {
		t.Fatalf("fetch by states: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}
	if issues[0].Identifier != "ORC-10" || issues[1].Identifier != "ORC-20" {
		t.Fatalf("expected sorted identifiers [ORC-10, ORC-20], got [%s, %s]", issues[0].Identifier, issues[1].Identifier)
	}
}

func TestFetchCandidateIssuesReturnsGraphQLErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth := r.Header.Get("Authorization"); !strings.HasPrefix(auth, "Bearer ") {
			t.Fatalf("expected bearer auth header")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"errors": []map[string]any{{"message": "bad"}}})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	_, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err == nil {
		t.Fatalf("expected graphql error")
	}
	if !strings.Contains(err.Error(), "bad") {
		t.Fatalf("expected graphql error message detail, got %v", err)
	}
}

func TestFetchCandidateIssuesPaginates(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Todo"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "candidate-cursor"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "In Progress"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo", "In Progress"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 candidates from paginated responses, got %d", len(issues))
	}
}

func TestFetchCandidateIssuesDeduplicatesAcrossPages(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Todo"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "candidate-cursor"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "duplicate", "state": map[string]any{"name": "Todo"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected duplicate issue to be collapsed, got %d", len(issues))
	}
}

func TestFetchCandidateIssuesSortsDeterministically(t *testing.T) {
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "later", "state": map[string]any{"name": "Todo"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "candidate-cursor"},
					},
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "earlier", "state": map[string]any{"name": "Todo"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected 2 issues, got %d", len(issues))
	}
	if issues[0].Identifier != "ORC-1" || issues[1].Identifier != "ORC-2" {
		t.Fatalf("expected sorted identifiers [ORC-1, ORC-2], got [%s, %s]", issues[0].Identifier, issues[1].Identifier)
	}
}

func TestFetchCandidateIssuesErrorsWhenNextPageCursorMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Todo"}}},
					"pageInfo": map[string]any{"hasNextPage": true, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	_, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err == nil {
		t.Fatalf("expected missing end cursor error")
	}
	if !strings.Contains(err.Error(), "missing end cursor") {
		t.Fatalf("expected missing end cursor detail, got %v", err)
	}
}

func TestFetchIssuesByStatesSendsAfterCursorOnLaterPages(t *testing.T) {
	var sawAfter bool
	var page int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var requestBody map[string]any
		if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		variables, _ := requestBody["variables"].(map[string]any)

		current := atomic.AddInt32(&page, 1)
		if current == 1 {
			if _, ok := variables["after"]; ok {
				t.Fatalf("did not expect after variable on first page")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"issues": map[string]any{
						"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Done"}}},
						"pageInfo": map[string]any{"hasNextPage": true, "endCursor": "cursor-1"},
					},
				},
			})
			return
		}

		if variables["after"] == "cursor-1" {
			sawAfter = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	_, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err != nil {
		t.Fatalf("fetch by states: %v", err)
	}
	if !sawAfter {
		t.Fatalf("expected pagination request to include after cursor")
	}
}

func TestFetchIssuesByStatesErrorsWhenNextPageCursorMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes":    []map[string]any{{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Done"}}},
					"pageInfo": map[string]any{"hasNextPage": true, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	_, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err == nil {
		t.Fatalf("expected missing end cursor error")
	}
	if !strings.Contains(err.Error(), "missing end cursor") {
		t.Fatalf("expected missing end cursor detail, got %v", err)
	}
}

func TestFetchIssuesByStatesIncludesHTTPErrorDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream unavailable"))
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	_, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err == nil {
		t.Fatalf("expected http error")
	}
	if !strings.Contains(err.Error(), "upstream unavailable") {
		t.Fatalf("expected http error body in message, got %v", err)
	}
}

func TestFetchIssuesByStatesErrorsOnMissingDataEnvelope(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
	}))
	defer server.Close()

	client := NewClient(server.URL, "", "", nil, server.Client())
	_, err := client.FetchIssuesByStates(context.Background(), []string{"Done"})
	if err == nil {
		t.Fatalf("expected missing data error")
	}
	if !strings.Contains(err.Error(), "missing data") {
		t.Fatalf("expected missing data envelope error, got %v", err)
	}
}

func TestFetchCandidateIssuesExtractsAssigneeAndBlockers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"id":          "1",
						"identifier":  "ORC-1",
						"title":       "a",
						"description": "desc",
						"priority":    3,
						"state":       map[string]any{"name": "Todo"},
						"branchName":  "orc-1-a",
						"url":         "https://tracker/ORC-1",
						"assignee":    map[string]any{"id": "user-1"},
						"labels":      map[string]any{"nodes": []map[string]any{{"name": "BackEnd"}, {"name": "URGENT"}}},
						"inverseRelations": map[string]any{
							"nodes": []map[string]any{
								{"type": "blocks", "issue": map[string]any{"id": "B-1", "identifier": "ORC-B1", "state": map[string]any{"name": "In Progress"}}},
								{"type": "BLOCKS", "issue": map[string]any{"id": "B-2", "identifier": "ORC-B2", "state": map[string]any{"name": "Todo"}}},
								{"type": "relates_to", "issue": map[string]any{"id": "X-1", "state": map[string]any{"name": "Done"}}},
							},
						},
						"createdAt": "2026-01-01T00:00:00Z",
						"updatedAt": "2026-01-02T00:00:00Z",
					}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %d", len(issues))
	}
	if issues[0].AssigneeID != "user-1" {
		t.Fatalf("expected assignee user-1, got %q", issues[0].AssigneeID)
	}
	if len(issues[0].BlockedBy) != 2 {
		t.Fatalf("expected two blockers, got %+v", issues[0].BlockedBy)
	}
	if issues[0].BlockedBy[0].ID != "B-1" || issues[0].BlockedBy[0].Identifier != "ORC-B1" || issues[0].BlockedBy[0].State != "In Progress" {
		t.Fatalf("unexpected blocker payload: %+v", issues[0].BlockedBy[0])
	}
	if issues[0].BlockedBy[1].ID != "B-2" || issues[0].BlockedBy[1].Identifier != "ORC-B2" || issues[0].BlockedBy[1].State != "Todo" {
		t.Fatalf("unexpected blocker payload: %+v", issues[0].BlockedBy[1])
	}
	if !issues[0].AssignedToWorker {
		t.Fatalf("expected assigned_to_worker true when no worker assignee filter")
	}
	if issues[0].Description != "desc" || issues[0].Priority != 3 || issues[0].BranchName != "orc-1-a" {
		t.Fatalf("unexpected issue metadata fields: %+v", issues[0])
	}
	if issues[0].URL != "https://tracker/ORC-1" || issues[0].CreatedAt != "2026-01-01T00:00:00Z" || issues[0].UpdatedAt != "2026-01-02T00:00:00Z" {
		t.Fatalf("unexpected issue URL/time fields: %+v", issues[0])
	}
	if len(issues[0].Labels) != 2 || issues[0].Labels[0] != "backend" || issues[0].Labels[1] != "urgent" {
		t.Fatalf("unexpected issue labels: %+v", issues[0].Labels)
	}
}

func TestFetchCandidateIssuesEvaluatesWorkerAssigneeFilter(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"id":         "1",
						"identifier": "ORC-1",
						"title":      "a",
						"state":      map[string]any{"name": "Todo"},
						"assignee":   map[string]any{"id": "user-1"},
					}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", []string{"user-2"}, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 1 {
		t.Fatalf("expected one issue, got %d", len(issues))
	}
	if issues[0].AssignedToWorker {
		t.Fatalf("expected assigned_to_worker false when assignee is outside allowed worker set")
	}
}

func TestFetchCandidateIssuesResolvesMeWorkerAssignee(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		query, _ := body["query"].(string)
		if strings.Contains(query, "OrchestraViewer") {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"viewer": map[string]any{"id": "viewer-1"}}})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"id":         "1",
						"identifier": "ORC-1",
						"title":      "a",
						"state":      map[string]any{"name": "Todo"},
						"assignee":   map[string]any{"id": "viewer-1"},
					}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", []string{"me"}, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 1 || !issues[0].AssignedToWorker {
		t.Fatalf("expected me routing to resolve viewer assignment, got %+v", issues)
	}
}

func TestFetchCandidateIssuesCachesResolvedViewerID(t *testing.T) {
	var viewerCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		query, _ := body["query"].(string)
		if strings.Contains(query, "OrchestraViewer") {
			atomic.AddInt32(&viewerCalls, 1)
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"viewer": map[string]any{"id": "viewer-1"}}})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{{
						"id":         "1",
						"identifier": "ORC-1",
						"title":      "a",
						"state":      map[string]any{"name": "Todo"},
						"assignee":   map[string]any{"id": "viewer-1"},
					}},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", []string{"me"}, server.Client())
	for i := 0; i < 2; i++ {
		issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
		if err != nil {
			t.Fatalf("fetch candidates: %v", err)
		}
		if len(issues) != 1 || !issues[0].AssignedToWorker {
			t.Fatalf("expected worker-routable issue, got %+v", issues)
		}
	}
	if atomic.LoadInt32(&viewerCalls) != 1 {
		t.Fatalf("expected viewer id resolved once, got %d calls", viewerCalls)
	}
}

func TestFetchCandidateIssuesErrorsWhenMeViewerMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"viewer": map[string]any{}}})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", []string{"me"}, server.Client())
	_, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err == nil {
		t.Fatalf("expected missing viewer identity error")
	}
	if !strings.Contains(err.Error(), "viewer identity") {
		t.Fatalf("expected viewer identity error detail, got %v", err)
	}
}

func TestFetchCandidateIssuesMeFilterIncludesExplicitAssigneeIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		query, _ := body["query"].(string)
		if strings.Contains(query, "OrchestraViewer") {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"viewer": map[string]any{"id": "viewer-1"}}})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{
					"nodes": []map[string]any{
						{"id": "1", "identifier": "ORC-1", "title": "a", "state": map[string]any{"name": "Todo"}, "assignee": map[string]any{"id": "viewer-1"}},
						{"id": "2", "identifier": "ORC-2", "title": "b", "state": map[string]any{"name": "Todo"}, "assignee": map[string]any{"id": "user-2"}},
					},
					"pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""},
				},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", []string{"me", "user-2"}, server.Client())
	issues, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if len(issues) != 2 {
		t.Fatalf("expected two issues, got %d", len(issues))
	}
	if !issues[0].AssignedToWorker || !issues[1].AssignedToWorker {
		t.Fatalf("expected both issues assigned_to_worker with me+explicit filter, got %+v", issues)
	}
}

func TestFetchCandidateIssuesWithoutProjectDoesNotUseProjectFilterQuery(t *testing.T) {
	var capturedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		capturedQuery, _ = body["query"].(string)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{"nodes": []map[string]any{}, "pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""}},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "", nil, server.Client())
	_, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if strings.Contains(capturedQuery, "filter: {project") {
		t.Fatalf("expected no project filter when project is unset, query=%q", capturedQuery)
	}
}

func TestFetchCandidateIssuesWithProjectUsesProjectFilterQuery(t *testing.T) {
	var capturedQuery string
	var capturedProject any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		capturedQuery, _ = body["query"].(string)
		variables, _ := body["variables"].(map[string]any)
		capturedProject = variables["projectSlug"]
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"issues": map[string]any{"nodes": []map[string]any{}, "pageInfo": map[string]any{"hasNextPage": false, "endCursor": ""}},
			},
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token", "orch", nil, server.Client())
	_, err := client.FetchCandidateIssues(context.Background(), []string{"Todo"})
	if err != nil {
		t.Fatalf("fetch candidates: %v", err)
	}
	if !strings.Contains(capturedQuery, "filter: {project") {
		t.Fatalf("expected project filter when project is set, query=%q", capturedQuery)
	}
	if capturedProject != "orch" {
		t.Fatalf("expected projectSlug variable orch, got %v", capturedProject)
	}
}
