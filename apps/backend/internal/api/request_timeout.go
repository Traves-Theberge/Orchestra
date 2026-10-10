package api

import (
	"net/http"
)

// A live event subscription lasts until the client disconnects. Applying the
// REST deadline cancels healthy subscriptions every 30 seconds. Every other
// request goes through globalRequestTimeout, which leaves the rewind routes to
// their own longer timeout.
func restRequestTimeout(next http.Handler) http.Handler {
	timed := globalRequestTimeout(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/api/v1/events" && r.URL.Query().Get("once") != "1" {
			next.ServeHTTP(w, r)
			return
		}
		timed.ServeHTTP(w, r)
	})
}
