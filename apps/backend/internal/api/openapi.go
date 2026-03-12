package api

import (
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) GetOpenAPIYAML(w http.ResponseWriter, r *http.Request) {
	specPath := resolveOpenAPISpecPath()
	content, err := os.ReadFile(specPath)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "openapi_not_found", "OpenAPI spec not found")
		return
	}

	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func resolveOpenAPISpecPath() string {
	if _, err := os.Stat("../../docs/openapi.yaml"); err == nil {
		return filepath.Clean("../../docs/openapi.yaml")
	}
	return filepath.Clean("./docs/openapi.yaml")
}
