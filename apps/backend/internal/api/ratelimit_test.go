package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
	"github.com/rs/zerolog"
)

func TestRateLimiter_AllowWithinBurst(t *testing.T) {
	rl := &rateLimiter{
		visitors: make(map[string]*bucket),
		rate:     10,
		burst:    5,
	}

	for i := 0; i < 5; i++ {
		if !rl.allow("192.168.1.1") {
			t.Fatalf("request %d should have been allowed within burst limit", i+1)
		}
	}
}

func TestRateLimiter_RejectExceedingRate(t *testing.T) {
	rl := &rateLimiter{
		visitors: make(map[string]*bucket),
		rate:     1,
		burst:    3,
	}

	// Use up the burst
	for i := 0; i < 3; i++ {
		if !rl.allow("10.0.0.1") {
			t.Fatalf("request %d should have been allowed within burst", i+1)
		}
	}

	// Next request should be rejected
	if rl.allow("10.0.0.1") {
		t.Fatal("request exceeding burst should have been rejected")
	}
}

func TestRateLimiter_IndependentIPs(t *testing.T) {
	rl := &rateLimiter{
		visitors: make(map[string]*bucket),
		rate:     1,
		burst:    2,
	}

	// Exhaust IP A
	for i := 0; i < 2; i++ {
		rl.allow("ip-a")
	}
	if rl.allow("ip-a") {
		t.Fatal("ip-a should be rate-limited")
	}

	// IP B should still be allowed
	if !rl.allow("ip-b") {
		t.Fatal("ip-b should not be affected by ip-a's limit")
	}
}

func TestRateLimiter_TokenRefill(t *testing.T) {
	rl := &rateLimiter{
		visitors: make(map[string]*bucket),
		rate:     1000, // 1000 tokens/sec so refill is fast
		burst:    2,
	}

	// Exhaust tokens
	for i := 0; i < 2; i++ {
		rl.allow("refill-ip")
	}
	if rl.allow("refill-ip") {
		t.Fatal("should be rejected after burst exhausted")
	}

	// Manually advance lastSeen to simulate time passing
	rl.mu.Lock()
	b := rl.visitors["refill-ip"]
	b.lastSeen = b.lastSeen.Add(-10 * time.Millisecond) // 10ms ago at 1000/s = 10 tokens refilled
	rl.mu.Unlock()

	if !rl.allow("refill-ip") {
		t.Fatal("should be allowed after tokens have refilled")
	}
}

func TestRateLimitMiddleware_Returns429(t *testing.T) {
	mw := RateLimit(1, 2)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// First two requests should pass (burst=2)
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "middleware-test-ip"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: expected 200, got %d", i+1, rec.Code)
		}
	}

	// Third request should be rate-limited
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "middleware-test-ip"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatal("response missing error object")
	}
	if errObj["code"] != "rate_limited" {
		t.Fatalf("expected error code 'rate_limited', got %q", errObj["code"])
	}
}

func TestRateLimitMiddleware_ForwardedHeadersCannotBypassPeerLimit(t *testing.T) {
	for _, peers := range [][]string{
		{"192.0.2.1:1000", "192.0.2.1:2000", "[::ffff:192.0.2.1]:3000"},
		{"[2001:db8::1]:1000", "[2001:0db8:0:0:0:0:0:1]:2000", "[2001:db8::1]:3000"},
	} {
		t.Run(peers[0], func(t *testing.T) {
			handler := RateLimit(0, 1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			for i, peer := range peers {
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				req.RemoteAddr = peer
				req.Header.Set("X-Forwarded-For", []string{"198.51.100.1", "198.51.100.2, 203.0.113.1", "198.51.100.3"}[i])
				req.Header.Set("X-Real-IP", []string{"198.51.100.4", "198.51.100.5", "198.51.100.6"}[i])
				req.Header.Set("Forwarded", "for="+req.Header.Get("X-Real-IP"))
				rec := httptest.NewRecorder()
				handler.ServeHTTP(rec, req)
				want := http.StatusTooManyRequests
				if i == 0 {
					want = http.StatusOK
				}
				if rec.Code != want {
					t.Fatalf("peer %s with rotated headers: got %d, want %d", peer, rec.Code, want)
				}
			}
			// A distinct transport peer retains its own burst.
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = "192.0.2.2:1000"
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("independent peer: got %d, want 200", rec.Code)
			}
		})
	}
}

func TestRouter_RotatedForwardedHeadersAreRateLimitedOverHTTP(t *testing.T) {
	router := NewRouter(zerolog.Nop(), orchestrator.NewService(), &config.Config{
		Host: "127.0.0.1", WorkspaceRoot: t.TempDir(),
	})
	server := httptest.NewServer(router)
	defer server.Close()
	client := server.Client()
	client.Timeout = 5 * time.Second
	// Exercise the complete middleware chain over a real loopback socket. In
	// particular, no earlier middleware may replace the peer with these headers.
	for i := 0; i < 100; i++ {
		req, err := http.NewRequest(http.MethodGet, server.URL+"/healthz", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i+1))
		req.Header.Set("X-Real-IP", fmt.Sprintf("203.0.113.%d", i+1))
		req.Header.Set("Forwarded", "for="+req.Header.Get("X-Real-IP"))
		res, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode == http.StatusTooManyRequests {
			return
		}
		if res.StatusCode != http.StatusOK {
			t.Fatalf("request %d: unexpected HTTP status %d", i, res.StatusCode)
		}
	}
	t.Fatal("rotating untrusted forwarding headers bypassed the peer rate limit")
}
