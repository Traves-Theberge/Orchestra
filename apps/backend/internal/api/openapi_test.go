package api

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestEmbeddedOpenAPISpecMatchesRepositorySource(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "openapi.yaml"))
	if err != nil {
		t.Fatalf("read source OpenAPI spec: %v", err)
	}
	if !bytes.Equal(openAPISpec, source) {
		t.Fatal("embedded API spec differs from docs/openapi.yaml")
	}
}
