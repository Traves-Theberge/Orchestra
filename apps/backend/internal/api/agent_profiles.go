package api

import (
	"context"
	"encoding/json"

	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
)

// GetHarnessCapabilities handles GET /api/v1/harnesses/capabilities.
func (s *Server) GetHarnessCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"harnesses": agents.AllCapabilities()})
}

// GetAgentsOrProfiles keeps the legacy GET /api/v1/agents (registered
// provider names) when called without query parameters. With project_id,
// harness or view=profiles it returns the unified agent list.
func (s *Server) GetAgentsOrProfiles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !q.Has("project_id") && !q.Has("harness") && q.Get("view") != "profiles" {
		s.GetAgents(w, r)
		return
	}
	s.GetAgentProfiles(w, r)
}

// GetAgentProfiles handles GET /api/v1/agent-profiles?project_id=&harness=.
func (s *Server) GetAgentProfiles(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	q := r.URL.Query()
	list, err := s.agentCatalog.Agents(r.Context(), q.Get("project_id"), q.Get("workspace_id"), q.Get("harness"))
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"agents": list})
}

func decodeAgentInput(w http.ResponseWriter, r *http.Request) (agentcatalog.AgentInput, bool) {
	var in agentcatalog.AgentInput
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "Invalid agent body: "+err.Error())
		return in, false
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "One JSON object is required")
		return in, false
	}
	return in, true
}

func agentPathID(r *http.Request) string {
	raw := chi.URLParam(r, "id")
	if raw == "" {
		raw = chi.URLParam(r, "provider")
	}
	if id, err := url.PathUnescape(raw); err == nil {
		return id
	}
	return raw
}

// PostAgentProfile handles POST /api/v1/agents (Orchestra agents only).
func (s *Server) PostAgentProfile(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	in, ok := decodeAgentInput(w, r)
	if !ok {
		return
	}
	agent, err := s.agentCatalog.CreateOrchestraAgent(r.Context(), in)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, agent)
}

// PatchAgentProfile handles PATCH /api/v1/agents/{id} (Orchestra agents only).
// project_id may be sent in the body or the query string for project agents.
func (s *Server) PatchAgentProfile(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	in, ok := decodeAgentInput(w, r)
	if !ok {
		return
	}
	if in.ProjectID == "" {
		in.ProjectID = r.URL.Query().Get("project_id")
	}
	if in.WorkspaceID == "" {
		in.WorkspaceID = r.URL.Query().Get("workspace_id")
	}
	agent, err := s.agentCatalog.UpdateOrchestraAgent(r.Context(), agentPathID(r), in)
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, agent)
}

// DeleteAgentProfile handles DELETE /api/v1/agents/{id}?project_id=&content_hash=.
func (s *Server) DeleteAgentProfile(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	q := r.URL.Query()
	if err := s.agentCatalog.DeleteOrchestraAgent(r.Context(), agentPathID(r), q.Get("project_id"), q.Get("workspace_id"), q.Get("content_hash")); err != nil {
		s.agentCatalogError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetSkills handles GET /api/v1/skills?project_id=&harness=.
func (s *Server) GetSkills(w http.ResponseWriter, r *http.Request) {
	if !s.agentCatalogReady(w) {
		return
	}
	q := r.URL.Query()
	skills, err := s.agentCatalog.Skills(r.Context(), q.Get("project_id"), q.Get("workspace_id"), q.Get("harness"))
	if err != nil {
		s.agentCatalogError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"skills": skills})
}

// orchestraMCPServers lists Orchestra-managed servers (table + config).
func (s *Server) orchestraMCPServers(ctx context.Context) ([]mcp.Server, error) {
	var env map[string]string
	if s.config != nil {
		env = s.config.OrchestraMCPServers
	}
	return mcp.LoadOrchestraServers(ctx, s.db, env)
}

func readAntigravityMCP(home string) []ProviderMCPServer {
	raw, err := os.ReadFile(filepath.Join(home, ".gemini", "config", "mcp_config.json"))
	if err != nil {
		return nil
	}
	var doc struct {
		MCPServers map[string]struct {
			Command   string            `json:"command"`
			Args      []string          `json:"args"`
			Env       map[string]string `json:"env"`
			ServerURL string            `json:"serverUrl"`
			URL       string            `json:"url"`
			Disabled  bool              `json:"disabled"`
		} `json:"mcpServers"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	out := []ProviderMCPServer{}
	for name, srv := range doc.MCPServers {
		out = append(out, ProviderMCPServer{Name: name, Command: srv.Command, Args: srv.Args, Env: srv.Env, URL: firstNonBlank(srv.ServerURL, srv.URL), Enabled: !srv.Disabled})
	}
	return out
}

// readOMPMCP reads omp's user-level mcp.json (Claude-style mcpServers).
func readOMPMCP(home string) []ProviderMCPServer {
	raw, err := os.ReadFile(filepath.Join(home, ".omp", "agent", "mcp.json"))
	if err != nil {
		return nil
	}
	var doc struct {
		MCPServers map[string]struct {
			Type     string            `json:"type"`
			Command  string            `json:"command"`
			Args     []string          `json:"args"`
			Env      map[string]string `json:"env"`
			URL      string            `json:"url"`
			Disabled bool              `json:"disabled"`
		} `json:"mcpServers"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	out := []ProviderMCPServer{}
	for name, srv := range doc.MCPServers {
		out = append(out, ProviderMCPServer{Name: name, Type: srv.Type, Command: srv.Command, Args: srv.Args, Env: srv.Env, URL: srv.URL, Enabled: !srv.Disabled})
	}
	return out
}

func firstNonBlank(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// harnessMCPServers lists servers from each harness's own global config.
func harnessMCPServers() []mcp.Server {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	sources := []struct {
		harness string
		read    func(string) []ProviderMCPServer
	}{
		{"CLAUDE", readClaudeMCP}, {"CODEX", readCodexMCP}, {"OPENCODE", readOpenCodeMCP}, {"ANTIGRAVITY", readAntigravityMCP}, {"OMP", readOMPMCP},
	}
	out := []mcp.Server{}
	for _, src := range sources {
		for _, p := range src.read(home) {
			kind := "local"
			if p.URL != "" && p.Command == "" || p.Type == "http" || p.Type == "sse" || p.Type == "remote" {
				kind = "remote"
			}
			args := p.Args
			if args == nil {
				args = []string{}
			}
			out = append(out, mcp.Server{Name: p.Name, Type: kind, Command: p.Command, Args: args, Env: p.Env, URL: p.URL, Enabled: p.Enabled, Source: "harness", Harness: src.harness})
		}
	}
	return out
}

func redactServer(s mcp.Server) mcp.Server {
	redact := func(m map[string]string) map[string]string {
		if len(m) == 0 {
			return m
		}
		out := make(map[string]string, len(m))
		for k := range m {
			out[k] = "***"
		}
		return out
	}
	s.Env, s.Headers = redact(s.Env), redact(s.Headers)
	return s
}

func (s *Server) mcpProber() *mcp.Prober {
	mcpProberOnce.Do(func() { sharedMCPProber = mcp.NewProber() })
	return sharedMCPProber
}

var (
	mcpProberOnce   sync.Once
	sharedMCPProber *mcp.Prober
)

// GetMCPServerStatus handles GET /api/v1/mcp/servers/status. Orchestra
// servers are probed (60s cache); harness-native servers report cached
// status unless ?probe=all.
func (s *Server) GetMCPServerStatus(w http.ResponseWriter, r *http.Request) {
	orchestra, err := s.orchestraMCPServers(r.Context())
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "mcp_failed", err.Error())
		return
	}
	prober := s.mcpProber()
	probeAll := r.URL.Query().Get("probe") == "all"
	all := append(orchestra, harnessMCPServers()...)
	out := make([]mcp.Server, len(all))
	var wg sync.WaitGroup
	for i := range all {
		if all[i].Source == "orchestra" || probeAll {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				out[i] = prober.Probe(r.Context(), all[i], false)
			}(i)
			continue
		}
		out[i] = prober.Cached(all[i])
	}
	wg.Wait()
	for i := range out {
		out[i] = redactServer(out[i])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Source != out[j].Source {
			return out[i].Source > out[j].Source
		}
		return out[i].Harness+out[i].Name < out[j].Harness+out[j].Name
	})
	writeJSON(w, http.StatusOK, map[string]any{"servers": out})
}

// PostMCPServerProbe handles POST /api/v1/mcp/servers/{name}/probe. An
// Orchestra server is chosen unless ?harness= names a harness-native one.
func (s *Server) PostMCPServerProbe(w http.ResponseWriter, r *http.Request) {
	name, _ := url.PathUnescape(chi.URLParam(r, "id"))
	harness := strings.ToUpper(r.URL.Query().Get("harness"))
	var candidates []mcp.Server
	if harness == "" {
		servers, err := s.orchestraMCPServers(r.Context())
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "mcp_failed", err.Error())
			return
		}
		candidates = servers
	} else {
		for _, srv := range harnessMCPServers() {
			if srv.Harness == harness {
				candidates = append(candidates, srv)
			}
		}
	}
	srv, err := mcp.FindServer(candidates, name)
	if err != nil {
		writeJSONError(w, http.StatusNotFound, "mcp_server_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, redactServer(s.mcpProber().Probe(r.Context(), srv, true)))
}

type mcpServerBody struct {
	Name    string            `json:"name"`
	Command string            `json:"command"`
	Type    string            `json:"type"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Enabled *bool             `json:"enabled"`
}

// PostMCPServer handles POST /api/v1/mcp/servers. It accepts the legacy
// {name, command} body and the full McpServer shape.
func (s *Server) PostMCPServer(w http.ResponseWriter, r *http.Request) {
	var body mcpServerBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_json", "failed to decode request body")
		return
	}
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	if !agents.ValidMCPServerName(body.Name) {
		writeJSONError(w, http.StatusBadRequest, "invalid_mcp_server", "name must be letters, digits, '-' or '_'")
		return
	}
	if body.Type == "" {
		body.Type = "local"
		if body.URL != "" && body.Command == "" {
			body.Type = "remote"
		}
	}
	if body.Type != "local" && body.Type != "remote" || body.Type == "local" && strings.TrimSpace(body.Command) == "" || body.Type == "remote" && !strings.HasPrefix(body.URL, "http") {
		writeJSONError(w, http.StatusBadRequest, "invalid_mcp_server", "local servers need a command; remote servers need an http(s) url")
		return
	}
	enabled := body.Enabled == nil || *body.Enabled
	record, err := s.db.CreateMCPServerRecord(r.Context(), db.MCPServerRecord{Name: body.Name, Command: body.Command, Type: body.Type, Args: body.Args, Env: body.Env, URL: body.URL, Headers: body.Headers, Enabled: enabled})
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "database operation failed")
		return
	}
	s.reloadMCPRegistry(r.Context())
	writeJSON(w, http.StatusCreated, record)
}

// DeleteMCPServer handles DELETE /api/v1/mcp/servers/{id}.
func (s *Server) DeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "db_unavailable", "database not configured")
		return
	}
	if err := s.db.DeleteMCPServer(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "db_failed", "database operation failed")
		return
	}
	s.reloadMCPRegistry(r.Context())
	w.WriteHeader(http.StatusNoContent)
}

// reloadMCPRegistry rebuilds the registry from Orchestra servers without
// spawning them (a hanging server must not block an HTTP request).
func (s *Server) reloadMCPRegistry(ctx context.Context) {
	if s.orchestrator == nil {
		return
	}
	servers, err := s.orchestraMCPServers(ctx)
	if err != nil {
		return
	}
	all := map[string]string{}
	for k, v := range s.configMCPServers() {
		all[k] = v
	}
	for _, srv := range servers {
		all[srv.Name] = srv.CommandLine()
	}
	s.orchestrator.SetMCPRegistry(mcp.NewRegistry(mcp.RegistryCommands(servers), s.logger), all)
}

func (s *Server) configMCPServers() map[string]string {
	if s.config == nil {
		return nil
	}
	return s.config.MCPServers
}
