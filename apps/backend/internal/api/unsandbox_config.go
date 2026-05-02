package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"syscall"
)

// GetUnsandboxConfig returns the current unsandbox credential configuration.
// GET /api/v1/config/unsandbox
// Response: { "configured": true, "public_key": "pk_...", "has_secret": true }
func (s *Server) GetUnsandboxConfig(w http.ResponseWriter, r *http.Request) {
	pk, sk := loadUnsandboxKeys()

	writeJSON(w, http.StatusOK, map[string]any{
		"configured": pk != "" && sk != "",
		"public_key": pk,
		"has_secret": sk != "",
	})
}

// PostUnsandboxConfig saves unsandbox API credentials.
// POST /api/v1/config/unsandbox
// Body: { "public_key": "pk_...", "secret_key": "sk_..." }
//
// Keys are stored at ~/.unsandbox/accounts.csv with mode 0600.
// This follows the same credential resolution used by the unsandbox CLI and SDK.
func (s *Server) PostUnsandboxConfig(w http.ResponseWriter, r *http.Request) {
	var body struct {
		PublicKey string `json:"public_key"`
		SecretKey string `json:"secret_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_body", "expected JSON with public_key, secret_key")
		return
	}

	pk := strings.TrimSpace(body.PublicKey)
	sk := strings.TrimSpace(body.SecretKey)
	if pk == "" || sk == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_keys", "both public_key and secret_key are required")
		return
	}

	if err := saveUnsandboxKeys(pk, sk); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "save_failed", "failed to save configuration")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"configured": true,
		"public_key": pk,
		"has_secret": true,
	})
}

// DeleteUnsandboxConfig removes stored unsandbox credentials.
// DELETE /api/v1/config/unsandbox
func (s *Server) DeleteUnsandboxConfig(w http.ResponseWriter, r *http.Request) {
	csvPath, err := unsandboxCSVPath()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "path_error", "failed to resolve path")
		return
	}
	_ = os.Remove(csvPath)

	writeJSON(w, http.StatusOK, map[string]any{
		"configured": false,
	})
}

// --- helpers ---

func unsandboxCSVPath() (string, error) {
	u, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(u.HomeDir, ".unsandbox", "accounts.csv"), nil
}

func loadUnsandboxKeys() (publicKey, secretKey string) {
	// Check env vars first (highest priority)
	envPk := os.Getenv("UNSANDBOX_PUBLIC_KEY")
	envSk := os.Getenv("UNSANDBOX_SECRET_KEY")
	if envPk != "" && envSk != "" {
		return envPk, envSk
	}

	// Check ~/.unsandbox/accounts.csv
	csvPath, err := unsandboxCSVPath()
	if err != nil {
		return "", ""
	}

	data, err := os.ReadFile(csvPath)
	if err != nil {
		return "", ""
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.Split(line, ",")
		if len(parts) >= 2 {
			return strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		}
	}
	return "", ""
}

func saveUnsandboxKeys(publicKey, secretKey string) error {
	csvPath, err := unsandboxCSVPath()
	if err != nil {
		return err
	}

	dir := filepath.Dir(csvPath)

	// Set restrictive umask BEFORE any file/dir creation to prevent
	// a window where the file exists with lax permissions.
	// Permacomputer tripwire monitors for world-readable credential files.
	oldUmask := syscall.Umask(0077)
	defer syscall.Umask(oldUmask)

	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	// Belt-and-suspenders: enforce even if umask was ignored
	if err := os.Chmod(dir, 0700); err != nil {
		return fmt.Errorf("chmod dir: %w", err)
	}

	content := fmt.Sprintf("# unsandbox.com API credentials (managed by Orchestra)\n%s,%s\n", publicKey, secretKey)

	if err := os.WriteFile(csvPath, []byte(content), 0600); err != nil {
		return fmt.Errorf("write %s: %w", csvPath, err)
	}
	// Belt-and-suspenders: enforce even if umask was ignored
	if err := os.Chmod(csvPath, 0600); err != nil {
		return fmt.Errorf("chmod file: %w", err)
	}

	return nil
}
