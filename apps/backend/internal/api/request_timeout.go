package api

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// A live event subscription lasts until the client disconnects. Applying the
// REST deadline cancels healthy subscriptions every 30 seconds.
func restRequestTimeout(next http.Handler) http.Handler {
	timed := middleware.Timeout(30 * time.Second)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/events" && r.URL.Query().Get("once") != "1" {
			next.ServeHTTP(w, r)
			return
		}
		timed.ServeHTTP(w, r)
	})
}
