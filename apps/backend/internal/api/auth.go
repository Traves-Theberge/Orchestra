package api

import (
	"net/http"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/runtime"
)

func hostRequiresProtectedAuth(host string) bool {
	return runtime.HostRequiresToken(host)
}

func requireBearerToken(token string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
			expected := "Bearer " + token
			if authHeader != expected {
				writeJSONError(w, http.StatusUnauthorized, "unauthorized", "missing or invalid bearer token")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
