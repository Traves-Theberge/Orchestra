package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
)

type DocItem struct {
	Name     string    `json:"name"`
	Path     string    `json:"path"`
	Category string    `json:"category"`
	IsFolder bool      `json:"is_folder"`
	Children []DocItem `json:"children,omitempty"`
}

func (s *Server) GetDocs(w http.ResponseWriter, r *http.Request) {
	root := "../../docs" // Relative to backend cmd or workspace root
	// Navigate up to find project root if needed, but assuming execution from project root or apps/backend
	absRoot := root
	if !filepath.IsAbs(root) {
		// Attempt to resolve based on common project structure
		if _, err := os.Stat("../../docs"); err == nil {
			absRoot = "../../docs"
		} else if _, err := os.Stat("./docs"); err == nil {
			absRoot = "./docs"
		}
	}

	docs, err := walkDocs(absRoot, "")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "docs_failed", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"docs": docs,
	})
}

func (s *Server) GetDocContent(w http.ResponseWriter, r *http.Request) {
	relPath := chi.URLParam(r, "*")
	if relPath == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid_path", "path is required")
		return
	}

	// Security: prevent path traversal
	cleanPath := filepath.Clean(relPath)
	if strings.Contains(cleanPath, "..") {
		writeJSONError(w, http.StatusForbidden, "access_denied", "invalid path")
		return
	}

	root := "../../docs"
	if _, err := os.Stat("../../docs"); err != nil {
		root = "./docs"
	}

	fullPath := filepath.Join(root, cleanPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "not_found", "document not found")
		return
	}

	w.Header().Set("Content-Type", "text/markdown")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}

func walkDocs(root, rel string) ([]DocItem, error) {
	dir := filepath.Join(root, rel)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var items []DocItem
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}

		itemRel := filepath.Join(rel, name)
		item := DocItem{
			Name:     name,
			Path:     itemRel,
			IsFolder: entry.IsDir(),
			Category: rel,
		}

		if entry.IsDir() {
			children, err := walkDocs(root, itemRel)
			if err == nil {
				item.Children = children
			}
		} else if !strings.HasSuffix(name, ".md") {
			continue
		}

		items = append(items, item)
	}
	return items, nil
}
