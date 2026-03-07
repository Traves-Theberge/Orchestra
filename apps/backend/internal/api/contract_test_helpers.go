package api

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/xeipuuv/gojsonschema"
)

func assertResponseMatchesSchema(t *testing.T, responseBody []byte, schemaFile string) {
	t.Helper()

	schemaPath := mustProtocolSchemaPath(t, schemaFile)

	schemaLoader := gojsonschema.NewReferenceLoader("file://" + schemaPath)
	documentLoader := gojsonschema.NewBytesLoader(responseBody)

	result, err := gojsonschema.Validate(schemaLoader, documentLoader)
	if err != nil {
		t.Fatalf("schema validation failed to run for %s: %v", schemaFile, err)
	}

	if result.Valid() {
		return
	}

	problems := ""
	for _, issue := range result.Errors() {
		problems += "\n- " + issue.String()
	}

	t.Fatalf("response does not match schema %s:%s", schemaFile, problems)
}

func mustProtocolSchemaPath(t *testing.T, schemaFile string) string {
	t.Helper()

	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("failed to resolve current file path")
	}

	path := filepath.Join(
		filepath.Dir(currentFile),
		"..", "..", "..", "..",
		"packages", "protocol", "schemas", "v1", schemaFile,
	)

	cleaned := filepath.Clean(path)
	if _, err := os.Stat(cleaned); err != nil {
		t.Fatalf("schema file not found %s: %v", cleaned, err)
	}

	abs, err := filepath.Abs(cleaned)
	if err != nil {
		t.Fatalf("resolve schema abs path %s: %v", cleaned, err)
	}

	return abs
}

func mustFixturePath(t *testing.T, fixtureFile string) string {
	t.Helper()

	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatalf("failed to resolve current file path")
	}

	path := filepath.Join(
		filepath.Dir(currentFile),
		"..", "..", "..", "..",
		"packages", "test-fixtures", "api", "v1", fixtureFile,
	)

	cleaned := filepath.Clean(path)
	if _, err := os.Stat(cleaned); err != nil {
		t.Fatalf("fixture file not found %s: %v", cleaned, err)
	}

	return cleaned
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}

	if len(raw) == 0 {
		t.Fatalf("file %s is empty", path)
	}

	return raw
}

func decodeFixtureMap(t *testing.T, fixtureFile string) map[string]any {
	t.Helper()

	path := mustFixturePath(t, fixtureFile)
	raw := mustReadFile(t, path)

	parsed, err := decodeJSONMap(raw)
	if err != nil {
		t.Fatalf("parse fixture %s: %v", fixtureFile, err)
	}

	return parsed
}

func decodeJSONMap(raw []byte) (map[string]any, error) {
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decode json map: %w", err)
	}
	return parsed, nil
}
