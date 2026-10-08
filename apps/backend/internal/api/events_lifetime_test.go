package api

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestEventsStreamSurvivesRESTRequestTimeout(t *testing.T) {
	server := httptest.NewServer(NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{
		WorkspaceRoot: t.TempDir(), Host: "127.0.0.1", APIToken: "stream-test-token",
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer stream-test-token")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("stream status: %d", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	if !scanner.Scan() || !strings.HasPrefix(scanner.Text(), "event: snapshot") {
		t.Fatalf("missing initial snapshot: %q, %v", scanner.Text(), scanner.Err())
	}
	ended := make(chan error, 1)
	go func() {
		for scanner.Scan() {
		}
		ended <- scanner.Err()
	}()
	select {
	case err := <-ended:
		t.Fatalf("live stream closed before the REST timeout elapsed: %v", err)
	case <-time.After(32 * time.Second):
	}
	cancel()
	select {
	case <-ended:
	case <-time.After(5 * time.Second):
		t.Fatal("stream did not stop after client cancellation")
	}
}

func TestRESTRequestDeadlineRemainsBounded(t *testing.T) {
	for _, path := range []string{"/api/v1/state", "/api/v1/events?once=1", "/api/v1/events/unknown"} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path, nil)
			restRequestTimeout(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				deadline, ok := r.Context().Deadline()
				if !ok || time.Until(deadline) > 30*time.Second {
					t.Fatal("ordinary request lost its bounded deadline")
				}
			})).ServeHTTP(httptest.NewRecorder(), request)
		})
	}
}

func TestEventStreamPreservesCallerDeadline(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	want, _ := ctx.Deadline()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/events", nil).WithContext(ctx)
	restRequestTimeout(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, ok := r.Context().Deadline()
		if !ok || !got.Equal(want) {
			t.Fatal("stream replaced the caller's deadline")
		}
	})).ServeHTTP(httptest.NewRecorder(), request)
}
