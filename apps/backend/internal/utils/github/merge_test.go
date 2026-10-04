package github

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type mergeFixtureTransport struct {
	target *url.URL
	calls  int
}

func (transport *mergeFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls++
	clone := request.Clone(request.Context())
	requestURL := *request.URL
	requestURL.Scheme, requestURL.Host = transport.target.Scheme, transport.target.Host
	clone.URL = &requestURL
	return http.DefaultTransport.RoundTrip(clone)
}

func TestMergePRReviewedHeadContract(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		status      int
		body        string
		want        error
		wantMessage string
	}{
		{name: "merged", status: 200, body: `{"merged":true}`},
		{name: "head changed", status: 409, body: `{"message":"Head changed"}`, want: ErrMergeHeadChanged},
		{name: "not merged", status: 200, body: `{"merged":false,"message":"requirements outstanding"}`, want: ErrMergeNotCompleted},
		{name: "missing status", status: 200, body: `{}`, wantMessage: "omitted merged status"},
		{name: "malformed result", status: 200, body: `{`, wantMessage: "decode GitHub merge result"},
		{name: "permission denied", status: 403, body: `{"message":"Forbidden"}`, wantMessage: "status 403"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodPut || request.URL.Path != "/repos/organization/repository/pulls/7/merge" {
					t.Errorf("wrong merge target: %s %s", request.Method, request.URL)
				}
				var payload MergeRequest
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				if payload.SHA != strings.Repeat("a", 40) || payload.MergeMethod != "squash" {
					t.Errorf("merge lost reviewed head or method: %+v", payload)
				}
				w.WriteHeader(scenario.status)
				_, _ = w.Write([]byte(scenario.body))
			}))
			defer fixture.Close()
			target, _ := url.Parse(fixture.URL)
			transport := &mergeFixtureTransport{target: target}
			previous := http.DefaultClient
			http.DefaultClient = &http.Client{Transport: transport}
			defer func() { http.DefaultClient = previous }()
			err := MergePR(context.Background(), "organization", "repository", "fixture-token", 7, "squash", strings.Repeat("A", 40))
			switch {
			case scenario.want != nil:
				if !errors.Is(err, scenario.want) {
					t.Fatalf("expected %v, got %v", scenario.want, err)
				}
			case scenario.wantMessage != "":
				if err == nil || !strings.Contains(err.Error(), scenario.wantMessage) {
					t.Fatalf("expected %q, got %v", scenario.wantMessage, err)
				}
			case err != nil:
				t.Fatal(err)
			}
			if transport.calls != 1 {
				t.Fatalf("expected exactly one atomic merge request, got %d", transport.calls)
			}
		})
	}
}

func TestMergePRRejectsMissingOrInvalidReviewedHeadBeforeHTTP(t *testing.T) {
	transport := &mergeFixtureTransport{}
	previous := http.DefaultClient
	http.DefaultClient = &http.Client{Transport: transport}
	defer func() { http.DefaultClient = previous }()
	for _, sha := range []string{"", "abc", strings.Repeat("g", 40), strings.Repeat("a", 39), strings.Repeat("a", 41), " " + strings.Repeat("a", 39)} {
		if err := MergePR(context.Background(), "organization", "repository", "fixture-token", 7, "merge", sha); err == nil {
			t.Fatalf("accepted invalid reviewed SHA %q", sha)
		}
	}
	if transport.calls != 0 {
		t.Fatalf("invalid head attempted %d HTTP requests", transport.calls)
	}
}
