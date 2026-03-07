package api

import (
	"net/http"

	"github.com/orchestra/orchestra/apps/backend/internal/staticassets"
)

func (s *Server) GetDashboard(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(staticassets.DashboardHTML))
}
