package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
)

// tailscaleConfig holds connection details for a remote Tailscale SSH host.
type tailscaleConfig struct {
	SSHHost      string `json:"ssh_host"`
	SSHUser      string `json:"ssh_user"`
	SSHKeyPath   string `json:"ssh_key_path"`
	SSHPort      int    `json:"ssh_port"`
	WorktreeRoot string `json:"worktree_root"`
	Configured   bool   `json:"configured"`
}

// kubernetesConfig holds connection details for a Kubernetes cluster runtime.
type kubernetesConfig struct {
	KubeconfigPath string `json:"kubeconfig_path"`
	Namespace      string `json:"namespace"`
	Image          string `json:"image"`
	GitRepoURL     string `json:"git_repo_url"`
	ServiceAccount string `json:"service_account"`
	Configured     bool   `json:"configured"`
}

// runtimeTargetsConfig is the root structure persisted to runtime-targets.json.
type runtimeTargetsConfig struct {
	Tailscale  tailscaleConfig  `json:"tailscale"`
	Kubernetes kubernetesConfig `json:"kubernetes"`
}

// defaultRuntimeTargetsConfig returns sensible defaults for an unconfigured system.
func defaultRuntimeTargetsConfig() runtimeTargetsConfig {
	return runtimeTargetsConfig{
		Tailscale: tailscaleConfig{
			SSHUser:      "root",
			SSHPort:      22,
			WorktreeRoot: "/tmp/orchestra-worktrees",
		},
		Kubernetes: kubernetesConfig{
			Namespace: "orchestra-agents",
			Image:     "ghcr.io/orchestra/agent-runner:latest",
		},
	}
}

// runtimeConfigPath returns the absolute path to the runtime-targets.json file.
func (s *Server) runtimeConfigPath() string {
	return filepath.Join(s.workspaceRoot, ".orchestra", "runtime-targets.json")
}

// loadRuntimeConfig reads and unmarshals the runtime-targets.json file.
// If the file does not exist, it returns a zero-value config with defaults.
func (s *Server) loadRuntimeConfig() (runtimeTargetsConfig, error) {
	cfg := defaultRuntimeTargetsConfig()
	data, err := os.ReadFile(s.runtimeConfigPath())
	if os.IsNotExist(err) {
		return cfg, nil
	}
	if err != nil {
		return cfg, fmt.Errorf("read runtime config: %w", err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parse runtime config: %w", err)
	}
	return cfg, nil
}

// saveRuntimeConfig marshals cfg to JSON and writes it atomically to the
// runtime-targets.json file, creating the parent directory if needed.
func (s *Server) saveRuntimeConfig(cfg runtimeTargetsConfig) error {
	dir := filepath.Dir(s.runtimeConfigPath())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal runtime config: %w", err)
	}
	if err := os.WriteFile(s.runtimeConfigPath(), data, 0o600); err != nil {
		return fmt.Errorf("write runtime config: %w", err)
	}
	return nil
}

// GetTailscaleConfig handles GET /api/v1/config/tailscale.
func (s *Server) GetTailscaleConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Tailscale)
}

// SaveTailscaleConfig handles POST /api/v1/config/tailscale.
func (s *Server) SaveTailscaleConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	var incoming tailscaleConfig
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}
	incoming.Configured = true
	cfg.Tailscale = incoming
	if err := s.saveRuntimeConfig(cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Tailscale)
}

// DeleteTailscaleConfig handles DELETE /api/v1/config/tailscale.
func (s *Server) DeleteTailscaleConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	cfg.Tailscale = tailscaleConfig{}
	if err := s.saveRuntimeConfig(cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_write_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// TestTailscaleConfig handles GET /api/v1/config/tailscale/test.
// It attempts a TCP dial to the configured SSH host and port.
func (s *Server) TestTailscaleConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	ts := cfg.Tailscale
	if ts.SSHHost == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable": false,
			"error":     "ssh_host is not configured",
		})
		return
	}
	port := ts.SSHPort
	if port <= 0 {
		port = 22
	}
	addr := net.JoinHostPort(ts.SSHHost, strconv.Itoa(port))
	conn, dialErr := net.DialTimeout("tcp", addr, 5e9) // 5 seconds
	if dialErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable": false,
			"error":     dialErr.Error(),
		})
		return
	}
	conn.Close()
	writeJSON(w, http.StatusOK, map[string]any{
		"reachable": true,
		"error":     "",
	})
}

// GetKubernetesConfig handles GET /api/v1/config/kubernetes.
func (s *Server) GetKubernetesConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Kubernetes)
}

// SaveKubernetesConfig handles POST /api/v1/config/kubernetes.
func (s *Server) SaveKubernetesConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	var incoming kubernetesConfig
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}
	incoming.Configured = true
	cfg.Kubernetes = incoming
	if err := s.saveRuntimeConfig(cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_write_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg.Kubernetes)
}

// DeleteKubernetesConfig handles DELETE /api/v1/config/kubernetes.
func (s *Server) DeleteKubernetesConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	cfg.Kubernetes = kubernetesConfig{}
	if err := s.saveRuntimeConfig(cfg); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_write_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetAvailableRuntimes handles GET /api/v1/config/runtimes.
// Returns which runtime targets are configured and available for dispatch.
func (s *Server) GetAvailableRuntimes(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	type runtimeEntry struct {
		Target     string `json:"target"`
		Configured bool   `json:"configured"`
	}
	runtimes := []runtimeEntry{
		{Target: "LOCAL", Configured: true},
		{Target: "TAILSCALE", Configured: cfg.Tailscale.Configured},
		{Target: "KUBERNETES", Configured: cfg.Kubernetes.Configured},
	}
	writeJSON(w, http.StatusOK, map[string]any{"runtimes": runtimes})
}

// TestKubernetesConfig handles GET /api/v1/config/kubernetes/test.
// It builds a clientset from the stored kubeconfig and calls ServerVersion.
func (s *Server) TestKubernetesConfig(w http.ResponseWriter, _ *http.Request) {
	cfg, err := s.loadRuntimeConfig()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "config_read_failed", err.Error())
		return
	}
	k8s := cfg.Kubernetes
	if k8s.KubeconfigPath == "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable":      false,
			"server_version": "",
			"error":          "kubeconfig_path is not configured",
		})
		return
	}
	clientset, clientErr := agents.NewKubernetesClientset(k8s.KubeconfigPath)
	if clientErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable":      false,
			"server_version": "",
			"error":          clientErr.Error(),
		})
		return
	}
	version, versionErr := clientset.Discovery().ServerVersion()
	if versionErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"reachable":      false,
			"server_version": "",
			"error":          versionErr.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"reachable":      true,
		"server_version": version.GitVersion,
		"error":          "",
	})
}
