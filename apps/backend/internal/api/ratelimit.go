package api

import (
	"net"
	"net/http"
	"net/netip"
	"sync"
	"time"
)

// rateLimiter implements a simple per-IP token bucket rate limiter
// using only the standard library.
type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*bucket
	rate     float64 // tokens per second
	burst    int     // max tokens
}

type bucket struct {
	tokens   float64
	lastSeen time.Time
}

func newRateLimiter(requestsPerSecond float64, burst int) *rateLimiter {
	rl := &rateLimiter{
		visitors: make(map[string]*bucket),
		rate:     requestsPerSecond,
		burst:    burst,
	}
	// Periodically evict stale entries to prevent unbounded growth.
	go rl.cleanup()
	return rl
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, ok := rl.visitors[ip]
	if !ok {
		rl.visitors[ip] = &bucket{
			tokens:   float64(rl.burst) - 1,
			lastSeen: now,
		}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(b.lastSeen).Seconds()
	b.tokens += elapsed * rl.rate
	if b.tokens > float64(rl.burst) {
		b.tokens = float64(rl.burst)
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func (rl *rateLimiter) cleanup() {
	for {
		time.Sleep(5 * time.Minute)
		rl.mu.Lock()
		cutoff := time.Now().Add(-10 * time.Minute)
		for ip, b := range rl.visitors {
			if b.lastSeen.Before(cutoff) {
				delete(rl.visitors, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// RateLimit returns middleware that limits requests per IP.
// rate: requests per second, burst: max burst size.
func RateLimit(requestsPerSecond float64, burst int) func(http.Handler) http.Handler {
	limiter := newRateLimiter(requestsPerSecond, burst)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// RemoteAddr is the transport peer. Forwarded headers are supplied by
			// clients and must not create a new bucket or rewrite this identity.
			ip := rateLimitPeer(r.RemoteAddr)

			if !limiter.allow(ip) {
				writeJSONError(w, http.StatusTooManyRequests, "rate_limited", "too many requests, please slow down")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func rateLimitPeer(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	if addr, err := netip.ParseAddr(host); err == nil {
		return addr.Unmap().String()
	}
	return host
}
