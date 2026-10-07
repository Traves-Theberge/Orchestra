// Package agentcatalog provides scoped, hash-guarded authoring for named agent
// definitions and skills. It does not treat discovery as proof that a harness
// can select or enforce a definition.
package agentcatalog

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
	"gopkg.in/yaml.v3"
)

type Kind string
type Scope string

const (
	KindAgentDefinition Kind  = "agent_definition"
	KindSkill           Kind  = "skill"
	KindOrchestraConfig Kind  = "orchestra_config"
	ScopeProject        Scope = "project"
	ScopeGlobal         Scope = "global"
	ScopeEffective      Scope = "effective"
)

const (
	SelectionSelectablePrimary   = "selectable_primary"
	SelectionConfiguredUnapplied = "configured_unapplied"
	SelectionUnavailable         = "unavailable"
	SelectionUnsupported         = "unsupported"
	SelectionUnknown             = "unknown"
)

var (
	ErrInvalid     = errors.New("invalid agent resource request")
	ErrNotFound    = errors.New("agent resource not found")
	ErrConflict    = errors.New("agent resource request conflicts with current content")
	ErrUnsupported = errors.New("agent resource kind or harness is unsupported")
	ErrForbidden   = errors.New("agent resource path is outside the authorized scope")
	ErrUnknown     = errors.New("agent resource mutation outcome is unknown; inspect its receipt before retrying")
	namePart       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$`)
)

type Item struct {
	ItemID              string `json:"item_id"`
	ID                  string `json:"id"`
	AgentID             string `json:"agent_id,omitempty"`
	Kind                Kind   `json:"kind"`
	Harness             string `json:"harness"`
	Scope               Scope  `json:"scope"`
	Path                string `json:"path"`
	ContentHash         string `json:"content_hash"`
	Format              string `json:"format,omitempty"`
	DisplayName         string `json:"display_name"`
	Description         string `json:"description,omitempty"`
	Mode                string `json:"mode,omitempty"`
	SelectableAsPrimary bool   `json:"selectable_as_primary"`
	SelectionStatus     string `json:"selection_status"`
	Reason              string `json:"reason,omitempty"`
	Content             string `json:"content,omitempty"`
}

type Capabilities struct {
	List            bool   `json:"list"`
	Create          bool   `json:"create"`
	Update          bool   `json:"update"`
	Delete          bool   `json:"delete"`
	SelectPrimary   bool   `json:"select_primary"`
	SelectionReason string `json:"selection_reason,omitempty"`
}

type Catalog struct {
	ProjectID           string       `json:"project_id"`
	WorkspaceID         string       `json:"workspace_id,omitempty"`
	Root                string       `json:"root,omitempty"`
	Harness             string       `json:"harness"`
	Scope               Scope        `json:"scope"`
	Observation         string       `json:"observation"`
	SelectionCapability string       `json:"selection_capability"`
	RuntimeVersion      string       `json:"runtime_version,omitempty"`
	Reason              string       `json:"reason,omitempty"`
	Capabilities        Capabilities `json:"capabilities"`
	Items               []Item       `json:"items"`
}

type Request struct {
	ProjectID   string
	WorkspaceID string
	Harness     string
	Scope       Scope
}

type MutationRequest struct {
	Operation    string `json:"operation"`
	ProjectID    string `json:"project_id"`
	WorkspaceID  string `json:"workspace_id,omitempty"`
	Harness      string `json:"harness"`
	Scope        Scope  `json:"scope"`
	Kind         Kind   `json:"kind"`
	ResourceID   string `json:"resource_id"`
	RequestID    string `json:"request_id"`
	ExpectedHash string `json:"expected_hash,omitempty"`
	Format       string `json:"format,omitempty"`
	Content      string `json:"content,omitempty"`
}

type Receipt struct {
	RequestID   string `json:"request_id"`
	Status      string `json:"status"`
	ProjectID   string `json:"project_id"`
	WorkspaceID string `json:"workspace_id,omitempty"`
	Harness     string `json:"harness"`
	Scope       Scope  `json:"scope"`
	Kind        Kind   `json:"kind"`
	ResourceID  string `json:"resource_id"`
	Path        string `json:"path,omitempty"`
	ContentHash string `json:"content_hash,omitempty"`
	Message     string `json:"message,omitempty"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

type Service struct {
	db            *db.DB
	roots         []string
	workspaceRoot string
	commands      map[string]string
	probeMu       sync.Mutex
	probeCache    map[string]runtimeProbe
	mu            sync.Mutex
}

type runtimeProbe struct{ capability, version, reason string }

func New(database *db.DB, allowedRoots []string, workspaceRoot string, commands ...map[string]string) (*Service, error) {
	if database == nil {
		return nil, errors.New("agent catalog storage unavailable")
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS agent_catalog_mutations (
		request_id TEXT PRIMARY KEY, digest TEXT NOT NULL, receipt TEXT NOT NULL,
		status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, err
	}
	if _, err := database.Exec(`UPDATE agent_catalog_mutations SET status='unknown', receipt=json_set(receipt,'$.status','unknown','$.message','Backend restarted during the resource mutation. Inspect the file and receipt before retrying.'), updated_at=CURRENT_TIMESTAMP WHERE status='pending'`); err != nil {
		return nil, err
	}
	commandMap := map[string]string{}
	for _, group := range commands {
		for key, value := range group {
			commandMap[strings.ToUpper(key)] = value
		}
	}
	return &Service{db: database, roots: append([]string(nil), allowedRoots...), workspaceRoot: workspaceRoot, commands: commandMap, probeCache: map[string]runtimeProbe{}}, nil
}

// List reads only the requested provider's native agent/skill directories and
// the existing Orchestra workspace.json file. Missing directories are empty;
// permission or malformed file errors make the observation unavailable.
func (s *Service) List(ctx context.Context, req Request) (Catalog, error) {
	harness, err := normalizeHarness(req.Harness)
	if err != nil {
		return Catalog{}, err
	}
	scopes, err := s.scopes(ctx, req)
	if err != nil {
		return Catalog{}, err
	}
	probe := s.selectionProbe(ctx, harness)
	canAuthor := supportsAuthoring(harness)
	observation := "observed"
	if len(resourceSpecs(harness, resolvedScope{scope: ScopeGlobal, root: ""})) == 0 {
		observation = "unsupported"
	}
	catalog := Catalog{ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: harness, Scope: req.Scope, Observation: observation, SelectionCapability: probe.capability, RuntimeVersion: probe.version, Reason: probe.reason, Capabilities: Capabilities{List: true, Create: canAuthor, Update: canAuthor, Delete: canAuthor, SelectPrimary: false, SelectionReason: probe.reason}, Items: []Item{}}
	if req.Scope == ScopeProject {
		catalog.Root = scopes[0].root
	}
	seen := map[string]bool{}
	for _, scope := range scopes {
		items, readErr := s.readScope(ctx, req.ProjectID, harness, scope, probe.capability)
		if readErr != nil {
			catalog.Observation = "unavailable"
			return Catalog{}, readErr
		}
		for _, item := range items {
			key := string(item.Kind) + ":" + string(item.Scope) + ":" + item.ID
			if !seen[key] {
				seen[key] = true
				catalog.Items = append(catalog.Items, item)
			}
		}
	}
	sort.Slice(catalog.Items, func(i, j int) bool {
		if catalog.Items[i].Kind != catalog.Items[j].Kind {
			return catalog.Items[i].Kind < catalog.Items[j].Kind
		}
		if catalog.Items[i].Scope != catalog.Items[j].Scope {
			return catalog.Items[i].Scope < catalog.Items[j].Scope
		}
		return catalog.Items[i].ID < catalog.Items[j].ID
	})
	return catalog, nil
}

func (s *Service) Get(ctx context.Context, req Request, kind Kind, resourceID string) (Item, error) {
	if kind != KindAgentDefinition && kind != KindSkill && kind != KindOrchestraConfig {
		return Item{}, ErrUnsupported
	}
	cat, err := s.List(ctx, req)
	if err != nil {
		return Item{}, err
	}
	for _, item := range cat.Items {
		if item.Kind == kind && item.ID == resourceID && (req.Scope == ScopeEffective || item.Scope == req.Scope) {
			path := item.Path
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return Item{}, readErr
			}
			item.Content = string(content)
			item.ContentHash = contentHash(content)
			return item, nil
		}
	}
	return Item{}, ErrNotFound
}

// ValidateSelection proves that the exact profile version is in scope and
// enabled for primary-agent selection. Discovery or profile metadata alone is
// never sufficient evidence.
func (s *Service) ValidateSelection(ctx context.Context, projectID, workspaceID, harness string, scope Scope, agentID, expectedHash, format string) error {
	if agentID == "" || expectedHash == "" || scope != ScopeProject && scope != ScopeGlobal {
		return ErrInvalid
	}
	if projectID == "__orchestrator__" && scope != ScopeGlobal {
		return ErrForbidden
	}
	cat, err := s.List(ctx, Request{ProjectID: projectID, WorkspaceID: workspaceID, Harness: harness, Scope: scope})
	if err != nil {
		return err
	}
	for _, item := range cat.Items {
		if item.Kind != KindAgentDefinition || item.AgentID != agentID || item.Scope != scope {
			continue
		}
		if item.ContentHash != expectedHash || format != "" && item.Format != format {
			return ErrConflict
		}
		if item.Mode == "subagent" {
			return fmt.Errorf("%w: %s", ErrUnsupported, "subagent definitions cannot be selected as primary")
		}
		return nil
	}
	return ErrNotFound
}

func (s *Service) GetReceipt(ctx context.Context, requestID string) (Receipt, error) {
	if !validRequestID(requestID) {
		return Receipt{}, ErrInvalid
	}
	var raw string
	if err := s.db.QueryRowContext(ctx, `SELECT receipt FROM agent_catalog_mutations WHERE request_id=?`, requestID).Scan(&raw); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Receipt{}, ErrNotFound
		}
		return Receipt{}, err
	}
	var receipt Receipt
	err := json.Unmarshal([]byte(raw), &receipt)
	return receipt, err
}

func (s *Service) GetProjectReceipt(ctx context.Context, projectID, requestID string) (Receipt, error) {
	receipt, err := s.GetReceipt(ctx, requestID)
	if err != nil {
		return Receipt{}, err
	}
	if receipt.ProjectID != projectID {
		return Receipt{}, ErrNotFound
	}
	return receipt, nil
}

func (s *Service) insertReceipt(ctx context.Context, digest string, receipt Receipt) error {
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO agent_catalog_mutations(request_id,digest,receipt,status) VALUES(?,?,?,?)`, receipt.RequestID, digest, string(encoded), receipt.Status)
	return err
}

func (s *Service) saveReceipt(ctx context.Context, receipt Receipt) error {
	receipt.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `UPDATE agent_catalog_mutations SET receipt=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=?`, string(encoded), receipt.Status, receipt.RequestID)
	return err
}

// Mutate performs create/update/delete with stable UUID replay and exact
// expected-hash checks. A replay returns its stored receipt and never repeats
// a filesystem effect.
func (s *Service) Mutate(ctx context.Context, req MutationRequest) (Receipt, error) {
	if err := validateMutation(req); err != nil {
		return Receipt{}, err
	}
	harness, _ := normalizeHarness(req.Harness)
	req.Harness = harness
	digest := requestDigest(req)
	s.mu.Lock()
	defer s.mu.Unlock()
	if prior, err := s.GetReceipt(ctx, req.RequestID); err == nil {
		var priorDigest string
		_ = s.db.QueryRowContext(ctx, `SELECT digest FROM agent_catalog_mutations WHERE request_id=?`, req.RequestID).Scan(&priorDigest)
		if priorDigest != digest {
			return Receipt{}, ErrConflict
		}
		if prior.Status == "pending" {
			prior.Status = "unknown"
			prior.Message = ErrUnknown.Error()
			if saveErr := s.saveReceipt(ctx, prior); saveErr != nil {
				return Receipt{}, ErrUnknown
			}
		}
		if prior.Status == "unknown" {
			return prior, ErrUnknown
		}
		return prior, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Receipt{}, err
	}
	path, err := s.targetPath(ctx, Request{ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope}, req.Kind, req.ResourceID, req.Format)
	if err != nil {
		return Receipt{}, err
	}
	scopes, err := s.scopes(ctx, Request{ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope})
	if err != nil {
		return Receipt{}, err
	}
	writeRoot := scopes[0].root
	if req.Kind == KindOrchestraConfig && req.Scope == ScopeGlobal {
		writeRoot = s.workspaceRoot
	}
	if err = ensureContained(writeRoot, path); err != nil {
		return Receipt{}, fmt.Errorf("agent resource path is outside authorized scope (root=%q, path=%q): %w", writeRoot, path, err)
	}
	current, readErr := os.ReadFile(path)
	exists := readErr == nil
	if readErr != nil && !errors.Is(readErr, os.ErrNotExist) {
		return Receipt{}, readErr
	}
	switch req.Operation {
	case "create":
		if exists || req.ExpectedHash != "" {
			return Receipt{}, ErrConflict
		}
	case "update", "delete":
		if !exists {
			return Receipt{}, ErrNotFound
		}
		if req.ExpectedHash == "" || req.ExpectedHash != contentHash(current) {
			return Receipt{}, ErrConflict
		}
	}
	if req.Operation != "delete" {
		if err = validateNativeContent(req, req.Content); err != nil {
			return Receipt{}, err
		}
	}
	if req.Kind == KindOrchestraConfig && req.Operation == "create" {
		return Receipt{}, ErrForbidden
	}
	if info, statErr := os.Lstat(path); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return Receipt{}, ErrForbidden
	} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return Receipt{}, statErr
	}
	pending := Receipt{RequestID: req.RequestID, Status: "pending", ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope, Kind: req.Kind, ResourceID: req.ResourceID, Path: path, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if err = s.insertReceipt(ctx, digest, pending); err != nil {
		return Receipt{}, err
	}
	status, message, newHash := "completed", "", ""
	if req.Operation == "delete" {
		if err = os.Remove(path); err != nil {
			status, message = "unknown", ErrUnknown.Error()
		} else {
			newHash = ""
		}
	} else {
		if err = atomicWrite(writeRoot, path, []byte(req.Content)); err != nil {
			status, message = "unknown", ErrUnknown.Error()
		} else {
			newHash = contentHash([]byte(req.Content))
		}
	}
	receipt := Receipt{RequestID: req.RequestID, Status: status, ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope, Kind: req.Kind, ResourceID: req.ResourceID, Path: path, ContentHash: newHash, Message: message, UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if saveErr := s.saveReceipt(ctx, receipt); saveErr != nil {
		return Receipt{}, ErrUnknown
	}
	if status == "unknown" {
		return receipt, ErrUnknown
	}
	return receipt, nil
}

func (s *Service) Execute(ctx context.Context, args map[string]any) map[string]any {
	// Control-plane adaptation is strict: reject unknown keys instead of
	// silently widening the file or provider scope.
	encoded, err := json.Marshal(args)
	if err != nil {
		return map[string]any{"error": ErrInvalid.Error()}
	}
	var req struct {
		Operation    string `json:"operation"`
		ProjectID    string `json:"project_id"`
		WorkspaceID  string `json:"workspace_id"`
		Harness      string `json:"harness"`
		Scope        Scope  `json:"scope"`
		Kind         Kind   `json:"kind"`
		ResourceID   string `json:"resource_id"`
		RequestID    string `json:"request_id"`
		ExpectedHash string `json:"expected_hash"`
		Format       string `json:"format"`
		Content      string `json:"content"`
	}
	dec := json.NewDecoder(strings.NewReader(string(encoded)))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&req); err != nil {
		return map[string]any{"error": ErrInvalid.Error()}
	}
	switch req.Operation {
	case "list":
		v, e := s.List(ctx, Request{ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope})
		if e != nil {
			return map[string]any{"error": e.Error()}
		}
		return asMap(v)
	case "get":
		v, e := s.Get(ctx, Request{ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope}, req.Kind, req.ResourceID)
		if e != nil {
			return map[string]any{"error": e.Error()}
		}
		return asMap(v)
	case "receipt":
		v, e := s.GetProjectReceipt(ctx, req.ProjectID, req.RequestID)
		if e != nil {
			return map[string]any{"error": e.Error()}
		}
		return asMap(v)
	case "create", "update", "delete":
		v, e := s.Mutate(ctx, MutationRequest{Operation: req.Operation, ProjectID: req.ProjectID, WorkspaceID: req.WorkspaceID, Harness: req.Harness, Scope: req.Scope, Kind: req.Kind, ResourceID: req.ResourceID, RequestID: req.RequestID, ExpectedHash: req.ExpectedHash, Format: req.Format, Content: req.Content})
		if e != nil {
			return map[string]any{"error": e.Error(), "receipt": v}
		}
		return asMap(v)
	default:
		return map[string]any{"error": ErrInvalid.Error()}
	}
}

func asMap(v any) map[string]any {
	raw, _ := json.Marshal(v)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	return result
}

type resolvedScope struct {
	scope Scope
	root  string
}

func (s *Service) scopes(ctx context.Context, req Request) ([]resolvedScope, error) {
	if req.Scope != ScopeProject && req.Scope != ScopeGlobal && req.Scope != ScopeEffective {
		return nil, ErrInvalid
	}
	if req.ProjectID == "__orchestrator__" && req.Scope != ScopeGlobal {
		return nil, ErrForbidden
	}
	result := []resolvedScope{}
	if req.Scope == ScopeGlobal || req.Scope == ScopeEffective {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return nil, fmt.Errorf("global home unavailable")
		}
		result = append(result, resolvedScope{ScopeGlobal, home})
	}
	if req.Scope == ScopeProject || req.Scope == ScopeEffective {
		project, err := s.db.GetProjectByID(ctx, req.ProjectID)
		if err != nil {
			return nil, ErrNotFound
		}
		if err = workspace.ValidateProjectPath(project.RootPath, s.roots); err != nil {
			return nil, ErrForbidden
		}
		wt, err := workspace.ResolveGitWorktree(ctx, project.ID, project.RootPath, req.WorkspaceID, s.roots)
		if err != nil {
			return nil, ErrForbidden
		}
		result = append(result, resolvedScope{ScopeProject, wt.Path})
	}
	return result, nil
}

func (s *Service) readScope(ctx context.Context, projectID, harness string, scope resolvedScope, capability string) ([]Item, error) {
	items := []Item{}
	for _, spec := range resourceSpecs(harness, scope) {
		found, err := walkResources(spec.root, spec.dir, spec.kind, harness, scope.scope, capability)
		if err != nil {
			return nil, fmt.Errorf("walking %s resource root=%q dir=%q: %w", spec.kind, spec.root, spec.dir, err)
		}
		items = append(items, found...)
	}
	if scope.scope == ScopeProject && projectID != "" {
		// This is an existing, canonical Orchestra-owned configuration file.
		path := filepath.Join(scope.root, ".orchestra", "agents", "workspace.json")
		if item, ok, err := readSingleConfig(scope.root, path, harness, scope.scope); err != nil {
			return nil, err
		} else if ok {
			items = append(items, item)
		}
	}
	if scope.scope == ScopeGlobal && filepath.Clean(s.workspaceRoot) != "." && s.workspaceRoot != "" {
		if info, statErr := os.Stat(s.workspaceRoot); statErr == nil && info.IsDir() {
			path := filepath.Join(s.workspaceRoot, ".orchestra", "agents", "workspace.json")
			if item, ok, err := readSingleConfig(s.workspaceRoot, path, harness, scope.scope); err != nil {
				return nil, err
			} else if ok {
				items = append(items, item)
			}
		} else if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return nil, statErr
		}
	}
	return items, nil
}

type resourceSpec struct {
	root, dir string
	kind      Kind
	ext       string
	nested    bool
}

func resourceSpecs(harness string, scope resolvedScope) []resourceSpec {
	base := scope.root
	var specs []resourceSpec
	switch harness {
	case "OPENCODE":
		if scope.scope == ScopeGlobal {
			base = filepath.Join(base, ".config", "opencode")
		} else {
			base = filepath.Join(base, ".opencode")
		}
		specs = append(specs, resourceSpec{base, filepath.Join(base, "agents"), KindAgentDefinition, ".md", true})
		specs = append(specs, resourceSpec{base, filepath.Join(base, "skills"), KindSkill, "", true})
	case "CLAUDE":
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".claude", "agents"), KindAgentDefinition, ".md", true})
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".claude", "skills"), KindSkill, "", true})
	case "CODEX":
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".codex", "agents"), KindAgentDefinition, ".toml", false})
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "skills"), KindSkill, "", true})
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".codex", "skills"), KindSkill, ".md", false})
	case "ANTIGRAVITY":
		if scope.scope == ScopeGlobal {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".gemini", "config", "agents"), KindAgentDefinition, ".md", true})
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".gemini", "antigravity-cli", "skills"), KindSkill, "", true})
		} else {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "agents"), KindAgentDefinition, ".md", true})
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "skills"), KindSkill, "", true})
		}
	default:
		return nil
	}

	if scope.scope == ScopeGlobal {
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "agents"), KindAgentDefinition, ".md", true})
		specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "skills"), KindSkill, "", true})
		if harness != "CODEX" {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".codex", "agents"), KindAgentDefinition, ".toml", false})
		}
		if harness != "CLAUDE" {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".claude", "agents"), KindAgentDefinition, ".md", true})
		}
		if harness != "OPENCODE" {
			specs = append(specs, resourceSpec{filepath.Join(scope.root, ".config", "opencode"), filepath.Join(scope.root, ".config", "opencode", "agents"), KindAgentDefinition, ".md", true})
		}
		if harness != "ANTIGRAVITY" {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".gemini", "config", "agents"), KindAgentDefinition, ".md", true})
		}
	} else if scope.scope == ScopeProject {
		if harness != "ANTIGRAVITY" {
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "agents"), KindAgentDefinition, ".md", true})
			specs = append(specs, resourceSpec{scope.root, filepath.Join(scope.root, ".agents", "skills"), KindSkill, "", true})
		}
	}

	return specs
}

func walkResources(root, dir string, kind Kind, harness string, scope Scope, capability string) ([]Item, error) {
	if _, err := os.Stat(dir); errors.Is(err, os.ErrNotExist) {
		return []Item{}, nil
	} else if err != nil {
		return nil, err
	}
	items := []Item{}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			return nil
		}
		canonical, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		rootAbs, err := filepath.Abs(root)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(rootAbs, canonical)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return ErrForbidden
		}
		format := strings.ToLower(filepath.Ext(path))
		if kind == KindAgentDefinition && format != ".md" && format != ".toml" {
			return nil
		}
		if kind == KindSkill && filepath.Base(path) != "SKILL.md" && format != ".md" {
			return nil
		}
		if kind == KindSkill && filepath.Base(path) != "SKILL.md" && harness == "OPENCODE" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		name := filepath.ToSlash(strings.TrimPrefix(path, dir+string(filepath.Separator)))
		id := filepath.ToSlash(strings.TrimSuffix(name, format))
		if kind == KindAgentDefinition && harness == "ANTIGRAVITY" && strings.EqualFold(filepath.Base(path), "agent.md") {
			id = filepath.ToSlash(filepath.Dir(name))
			if id == "." {
				id = ""
			}
		}
		if kind == KindSkill && filepath.Base(path) == "SKILL.md" {
			id = filepath.ToSlash(filepath.Dir(strings.TrimPrefix(path, dir+string(filepath.Separator))))
			if id == "." {
				id = ""
			}
		}
		if id == "" {
			return nil
		}
		meta := parseMetadata(data)
		status, reason := selectionStatus(harness, kind, meta.mode, capability)
		agentID := ""
		if kind == KindAgentDefinition {
			agentID = id
		}
		items = append(items, Item{ItemID: string(kind) + ":" + string(scope) + ":" + id, ID: id, AgentID: agentID, Kind: kind, Harness: harness, Scope: scope, Path: path, ContentHash: contentHash(data), Format: formatName(harness, format), DisplayName: first(meta.name, id), Description: meta.description, Mode: meta.mode, SelectableAsPrimary: status == "primary_selectable", SelectionStatus: status, Reason: reason})
		return nil
	})
	return items, err
}

func readSingleConfig(root, path, harness string, scope Scope) (Item, bool, error) {
	if err := ensureContained(root, path); err != nil {
		return Item{}, false, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Item{}, false, nil
	}
	if err != nil {
		return Item{}, false, err
	}
	return Item{ItemID: string(KindOrchestraConfig) + ":" + string(scope) + ":workspace.json", ID: "workspace.json", Kind: KindOrchestraConfig, Harness: harness, Scope: scope, Path: path, ContentHash: contentHash(data), Format: "json", DisplayName: "Orchestra workspace configuration", SelectionStatus: SelectionUnsupported, Reason: "This is Orchestra-owned workspace metadata, not a provider agent profile."}, true, nil
}

func (s *Service) targetPath(ctx context.Context, req Request, kind Kind, id, format string) (string, error) {
	if kind != KindAgentDefinition && kind != KindSkill && kind != KindOrchestraConfig {
		return "", ErrUnsupported
	}
	harness, err := normalizeHarness(req.Harness)
	if err != nil {
		return "", err
	}
	scopes, err := s.scopes(ctx, req)
	if err != nil {
		return "", err
	}
	if req.Scope == ScopeEffective || len(scopes) != 1 {
		return "", ErrInvalid
	}
	scope := scopes[0]
	if kind == KindOrchestraConfig {
		if id != "workspace.json" {
			return "", ErrForbidden
		}
		if scope.scope == ScopeGlobal {
			if s.workspaceRoot == "" {
				return "", ErrForbidden
			}
			return filepath.Join(s.workspaceRoot, ".orchestra", "agents", "workspace.json"), nil
		}
		return filepath.Join(scope.root, ".orchestra", "agents", "workspace.json"), nil
	}
	if !validResourceID(id, kind) {
		return "", ErrInvalid
	}
	specs := resourceSpecs(harness, scope)
	for _, spec := range specs {
		if spec.kind != kind {
			continue
		}
		if kind == KindAgentDefinition {
			ext := spec.ext
			if harness == "ANTIGRAVITY" && format != "antigravity-markdown" {
				return "", ErrInvalid
			}
			if harness == "OPENCODE" {
				if format != "" && format != "opencode-v1" && format != "opencode-v2" && format != "md" {
					return "", ErrInvalid
				}
				ext = ".md"
			}
			if harness == "CODEX" && format != "toml" && format != "" {
				return "", ErrInvalid
			}
			if harness == "CLAUDE" && format != "md" && format != "" {
				return "", ErrInvalid
			}
			if harness == "ANTIGRAVITY" {
				directoryForm := filepath.Join(spec.dir, filepath.FromSlash(id), "agent.md")
				fileForm := filepath.Join(spec.dir, filepath.FromSlash(id)+ext)
				if _, err := os.Stat(directoryForm); err == nil {
					return directoryForm, nil
				} else if !errors.Is(err, os.ErrNotExist) {
					return "", err
				}
				if _, err := os.Stat(fileForm); err == nil {
					return fileForm, nil
				} else if !errors.Is(err, os.ErrNotExist) {
					return "", err
				}
				return directoryForm, nil
			}
			return filepath.Join(spec.dir, filepath.FromSlash(id)+ext), nil
		}
		if harness == "OPENCODE" || harness == "CLAUDE" || harness == "ANTIGRAVITY" {
			return filepath.Join(spec.dir, filepath.FromSlash(id), "SKILL.md"), nil
		}
		if harness == "CODEX" {
			return filepath.Join(spec.dir, filepath.FromSlash(id), "SKILL.md"), nil
		}
	}
	return "", ErrUnsupported
}

func validateMutation(req MutationRequest) error {
	if !validRequestID(req.RequestID) || req.ProjectID == "" || req.ResourceID == "" || req.Scope != ScopeProject && req.Scope != ScopeGlobal {
		return ErrInvalid
	}
	if req.ProjectID == "__orchestrator__" && req.Scope != ScopeGlobal {
		return ErrForbidden
	}
	if _, err := normalizeHarness(req.Harness); err != nil {
		return err
	}
	if req.Operation != "create" && req.Operation != "update" && req.Operation != "delete" {
		return ErrInvalid
	}
	if req.Operation == "create" && req.ExpectedHash != "" {
		return ErrInvalid
	}
	if (req.Operation == "update" || req.Operation == "delete") && req.ExpectedHash == "" {
		return ErrInvalid
	}
	if len(req.Content) > 1024*1024 {
		return ErrInvalid
	}
	return nil
}

func validateNativeContent(req MutationRequest, content string) error {
	if !strings.Contains(content, "\n") || strings.TrimSpace(content) == "" {
		return ErrInvalid
	}
	if req.Kind == KindAgentDefinition {
		if req.Harness == "ANTIGRAVITY" {
			if req.Format != "antigravity-markdown" || !strings.HasPrefix(content, "---\n") {
				return ErrInvalid
			}
			end := strings.Index(content[4:], "\n---")
			if end < 0 {
				return fmt.Errorf("Antigravity agent frontmatter is incomplete")
			}
			var values map[string]any
			if err := yaml.Unmarshal([]byte(content[4:4+end]), &values); err != nil {
				return fmt.Errorf("invalid Antigravity agent frontmatter: %w", err)
			}
			name, _ := values["name"].(string)
			description, _ := values["description"].(string)
			if strings.TrimSpace(name) == "" || strings.TrimSpace(description) == "" {
				return fmt.Errorf("Antigravity agent frontmatter requires name and description")
			}
			return nil
		}
		if req.Harness == "OPENCODE" {
			if req.Format != "opencode-v1" && req.Format != "opencode-v2" {
				return ErrInvalid
			}
			if !strings.HasPrefix(content, "---\n") {
				return fmt.Errorf("OpenCode agent definitions require native Markdown frontmatter")
			}
			end := strings.Index(content[4:], "\n---")
			if end < 0 {
				return fmt.Errorf("OpenCode agent frontmatter is incomplete")
			}
			var values map[string]any
			if err := yaml.Unmarshal([]byte(content[4:4+end]), &values); err != nil {
				return fmt.Errorf("invalid OpenCode agent frontmatter: %w", err)
			}
			mode, _ := values["mode"].(string)
			if mode != "primary" && mode != "all" && mode != "subagent" {
				return fmt.Errorf("OpenCode agent mode must explicitly be primary, all, or subagent")
			}
			return nil
		}
		if req.Harness == "CODEX" && req.Format != "toml" {
			return ErrInvalid
		}
		if req.Harness == "CLAUDE" && req.Format != "md" {
			return ErrInvalid
		}
	}
	if req.Kind == KindOrchestraConfig {
		if req.ResourceID != "workspace.json" || !json.Valid([]byte(content)) {
			return ErrInvalid
		}
	}
	return nil
}

func selectionStatus(harness string, kind Kind, mode, capability string) (string, string) {
	if kind == KindSkill {
		return SelectionUnsupported, "Skills are not primary-agent profiles."
	}
	if harness == "ANTIGRAVITY" {
		return SelectionConfiguredUnapplied, "The CLI exposes --agent, but effective custom-agent selection has not been verified by an isolated native canary. Profile role metadata is preserved separately."
	}
	if mode == "subagent" {
		return "subagent_only", "This native definition is marked as a subagent."
	}
	if capability == SelectionUnavailable || capability == SelectionUnsupported {
		return capability, "The configured " + harness + " runtime has not established primary agent selection."
	}
	return SelectionSelectablePrimary, ""
}

func supportsAuthoring(harness string) bool {
	return harness == "OPENCODE" || harness == "CLAUDE" || harness == "CODEX" || harness == "ANTIGRAVITY"
}

func (s *Service) selectionProbe(ctx context.Context, harness string) runtimeProbe {
	command := strings.TrimSpace(s.commands[harness])
	if command == "" {
		return runtimeProbe{SelectionUnavailable, "", "No " + harness + " command is configured."}
	}
	return runtimeProbe{SelectionSelectablePrimary, "", ""}
}

func probeOpenCodeCommand(ctx context.Context, command string) runtimeProbe {
	binary, ok := configuredExecutable(command)
	if !ok {
		return runtimeProbe{SelectionUnknown, "", "The configured OpenCode command is a shell expression; its executable cannot be safely probed."}
	}
	if filepath.Base(strings.ToLower(binary)) != "opencode" && filepath.Base(strings.ToLower(binary)) != "opencode.exe" {
		return runtimeProbe{SelectionUnknown, "", "The configured command does not directly identify the OpenCode executable."}
	}
	resolved, err := exec.LookPath(binary)
	if err != nil {
		return runtimeProbe{SelectionUnavailable, "", "The configured OpenCode executable is not installed or not on PATH."}
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	versionOut, versionErr := exec.CommandContext(probeCtx, resolved, "--version").CombinedOutput()
	if versionErr != nil {
		return runtimeProbe{SelectionUnknown, "", "OpenCode version could not be observed from the configured executable."}
	}
	version := strings.TrimSpace(string(versionOut))
	helpCtx, helpCancel := context.WithTimeout(ctx, 3*time.Second)
	defer helpCancel()
	helpOut, helpErr := exec.CommandContext(helpCtx, resolved, "run", "--help").CombinedOutput()
	if helpErr != nil {
		return runtimeProbe{SelectionUnknown, version, "OpenCode run --help could not be observed safely."}
	}
	if !strings.Contains(string(helpOut), "--agent") {
		return runtimeProbe{SelectionUnsupported, version, "The configured OpenCode CLI does not advertise run --agent."}
	}
	return runtimeProbe{SelectionConfiguredUnapplied, version, "The configured OpenCode CLI advertises run --agent, but Orchestra has no isolated effective-agent canary for this version."}
}

// probeAntigravityCommand performs only bounded, read-only CLI probes. Agent
// selection remains configured-but-unapplied until a native canary verifies
// the effective custom agent for the installed version.
func probeAntigravityCommand(ctx context.Context, command string) runtimeProbe {
	binary, ok := configuredExecutable(command)
	if !ok {
		return runtimeProbe{SelectionUnknown, "", "The configured Antigravity command is a shell expression; its executable cannot be safely probed."}
	}
	base := strings.ToLower(filepath.Base(binary))
	if base != "agy" && base != "agy.exe" {
		return runtimeProbe{SelectionUnknown, "", "The configured command does not directly identify the Antigravity CLI executable."}
	}
	resolved, err := exec.LookPath(binary)
	if err != nil {
		return runtimeProbe{SelectionUnavailable, "", "The configured Antigravity executable is not installed or not on PATH."}
	}
	versionCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	versionOut, versionErr := exec.CommandContext(versionCtx, resolved, "--version").CombinedOutput()
	if versionErr != nil {
		return runtimeProbe{SelectionUnknown, "", "Antigravity CLI version could not be observed safely."}
	}
	version := strings.TrimSpace(string(versionOut))
	helpCtx, helpCancel := context.WithTimeout(ctx, 3*time.Second)
	defer helpCancel()
	helpOut, helpErr := exec.CommandContext(helpCtx, resolved, "--help").CombinedOutput()
	if helpErr != nil {
		return runtimeProbe{SelectionUnknown, version, "Antigravity CLI help could not be observed safely."}
	}
	help := string(helpOut)
	for _, flag := range []string{"--agent", "--input-format", "--output-format", "--conversation"} {
		if !strings.Contains(help, flag) {
			return runtimeProbe{SelectionUnsupported, version, "The configured Antigravity CLI does not advertise the required native session flags."}
		}
	}
	return runtimeProbe{SelectionConfiguredUnapplied, version, "The CLI advertises native agent selection and resumable stream-json sessions; effective custom-agent selection has not been verified with an isolated provider canary."}
}

func configuredExecutable(command string) (string, bool) {
	var out strings.Builder
	quote := rune(0)
	escaped := false
	started := false
	for _, ch := range command {
		if escaped {
			out.WriteRune(ch)
			escaped = false
			started = true
			continue
		}
		if ch == '\\' && quote != '\'' {
			escaped = true
			continue
		}
		if quote != 0 {
			if ch == quote {
				quote = 0
			} else {
				out.WriteRune(ch)
			}
			started = true
			continue
		}
		if ch == '\'' || ch == '"' {
			quote = ch
			started = true
			continue
		}
		if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
			if started {
				break
			}
			continue
		}
		if strings.ContainsRune(";&|<>$`()", ch) {
			return "", false
		}
		out.WriteRune(ch)
		started = true
	}
	if quote != 0 || escaped || out.Len() == 0 {
		return "", false
	}
	return out.String(), true
}

func first(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func parseMetadata(data []byte) struct{ name, description, mode string } {
	var out struct{ name, description, mode string }
	text := string(data)
	if !strings.HasPrefix(text, "---\n") {
		return out
	}
	end := strings.Index(text[4:], "\n---")
	if end < 0 {
		return out
	}
	var fields map[string]any
	if yaml.Unmarshal([]byte(text[4:4+end]), &fields) != nil {
		return out
	}
	out.name, _ = fields["name"].(string)
	out.description, _ = fields["description"].(string)
	out.mode, _ = fields["mode"].(string)
	if subagent, ok := fields["subagent"].(bool); ok && subagent {
		out.mode = "subagent"
	} else if mainAgent, ok := fields["mainAgent"].(bool); ok {
		if mainAgent {
			out.mode = "primary"
		} else {
			out.mode = "subagent"
		}
	}
	return out
}
func formatName(harness, ext string) string {
	if harness == "OPENCODE" && ext == ".md" {
		return "opencode-markdown"
	}
	if harness == "ANTIGRAVITY" && ext == ".md" {
		return "antigravity-markdown"
	}
	return strings.TrimPrefix(ext, ".")
}
func normalizeHarness(raw string) (string, error) {
	v := strings.ToUpper(strings.TrimSpace(raw))
	switch v {
	case "OPENCODE", "CODEX", "CLAUDE", "GEMINI", "8GENT", "ANTIGRAVITY":
		return v, nil
	default:
		return "", ErrUnsupported
	}
}
func validResourceID(id string, kind Kind) bool {
	if id == "" || strings.Contains(id, "\\") || strings.HasPrefix(id, "/") || filepath.IsAbs(id) {
		return false
	}
	if kind == KindOrchestraConfig {
		return id == "workspace.json"
	}
	for _, part := range strings.Split(filepath.ToSlash(id), "/") {
		if !namePart.MatchString(part) || part == "." || part == ".." {
			return false
		}
	}
	return true
}
func validRequestID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed != uuid.Nil && parsed.String() == id
}
func contentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:])
}
func requestDigest(req MutationRequest) string {
	req.Operation = strings.ToLower(req.Operation)
	raw, _ := json.Marshal(req)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func atomicWrite(root, path string, data []byte) error {
	if err := ensureContained(root, path); err != nil {
		return fmt.Errorf("atomic target outside authorized scope (root=%q,path=%q): %w", root, path, err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := ensureContained(root, path); err != nil {
		return fmt.Errorf("atomic target outside authorized scope (root=%q,path=%q): %w", root, path, err)
	}
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return ErrForbidden
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".orchestra-agent-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return replaceFile(tmpName, path)
}

func ensureContained(root, target string) error {
	if root == "" {
		return ErrForbidden
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return ErrForbidden
	}
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return ErrForbidden
	}
	if _, err := os.Lstat(targetAbs); err == nil {
		if resolved, resolveErr := filepath.EvalSymlinks(targetAbs); resolveErr == nil {
			targetAbs = resolved
		} else {
			return ErrForbidden
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	missing := []string{}
	cursor := filepath.Dir(targetAbs)
	for {
		resolved, resolveErr := filepath.EvalSymlinks(cursor)
		if resolveErr == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			targetAbs = filepath.Join(resolved, filepath.Base(targetAbs))
			break
		}
		if !errors.Is(resolveErr, os.ErrNotExist) {
			return ErrForbidden
		}
		parent := filepath.Dir(cursor)
		if parent == cursor {
			return ErrForbidden
		}
		missing = append(missing, filepath.Base(cursor))
		cursor = parent
	}
	rootAbs, err := filepath.Abs(canonicalRoot)
	if err != nil {
		return ErrForbidden
	}
	rel, err := filepath.Rel(rootAbs, targetAbs)
	if err != nil || rel == "." || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ErrForbidden
	}
	return nil
}
