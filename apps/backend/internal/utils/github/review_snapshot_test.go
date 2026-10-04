package github

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
)

type snapshotFixtureTransport func(*http.Request) (*http.Response, error)

func (f snapshotFixtureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestGetReviewSnapshotPinnedCommits(t *testing.T) {
	for _, scenario := range []string{"stable", "head_changed", "base_changed", "wrong_identity", "compare_failed", "missing_sha"} {
		t.Run(scenario, func(t *testing.T) {
			base, head := strings.Repeat("a", 40), strings.Repeat("b", 40)
			calls := 0
			previous := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: snapshotFixtureTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != "GET" || r.URL.Host != "api.github.com" || r.Header.Get("Authorization") != "token fixture" {
					t.Fatalf("unexpected request: %s %s", r.Method, r.URL)
				}
				status, body := 200, ""
				if calls == 2 {
					if r.URL.Path != "/repos/owner/repo/compare/"+base+"..."+head || r.Header.Get("Accept") != "application/vnd.github.diff" {
						t.Fatalf("diff was not commit-pinned: %s", r.URL)
					}
					body = "diff --git a/file b/file\n+reviewed-content"
					if scenario == "compare_failed" {
						status = 503
					}
				} else {
					if r.URL.Path != "/repos/owner/repo/pulls/42" {
						t.Fatalf("wrong identity: %s", r.URL)
					}
					returnedBase, returnedHead, number := base, head, 42
					if calls == 3 && scenario == "head_changed" {
						returnedHead = strings.Repeat("c", 40)
					}
					if calls == 3 && scenario == "base_changed" {
						returnedBase = strings.Repeat("c", 40)
					}
					if scenario == "wrong_identity" {
						number = 43
					}
					if scenario == "missing_sha" {
						returnedHead = ""
					}
					body = fmt.Sprintf(`{"number":%d,"state":"open","head":{"sha":%q},"base":{"sha":%q}}`, number, returnedHead, returnedBase)
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
			})}
			t.Cleanup(func() { http.DefaultClient = previous })
			snapshot, err := GetReviewSnapshot(context.Background(), "owner", "repo", "fixture", 42)
			if scenario == "stable" {
				if err != nil || snapshot.PR.Head.SHA != head || !strings.Contains(snapshot.Diff, "reviewed-content") || calls != 3 {
					t.Fatalf("snapshot=%+v calls=%d err=%v", snapshot, calls, err)
				}
			} else if err == nil || snapshot != nil {
				t.Fatalf("unsafe snapshot accepted: %+v %v", snapshot, err)
			}
		})
	}
}
