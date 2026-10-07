// Package registry holds the TrackerRegistry — a runtime collection of tracker
// adapter instances keyed by config ID, routing per-project lookups to the right backend.
package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/tracker"
)

// AdapterFactory builds an Adapter from a TrackerConfig and a decrypted token.
// Injected into the Registry to avoid an import cycle with the per-tracker packages
// (linear/, jira/, github/) that depend on this one's types.
type AdapterFactory func(cfg *db.TrackerConfig, token string) (tracker.Adapter, error)

// Registry holds all configured tracker adapter instances and routes per-project lookups.
type Registry struct {
	mu       sync.RWMutex
	adapters map[string]tracker.Adapter // configID → adapter
	database *db.DB
	factory  AdapterFactory
}

// NewWithFactory creates a Registry that uses the provided factory to build adapters.
// On startup it loads all tracker_configs rows and instantiates each.
// Adapters that fail to build (decryption error, unsupported type, missing creds)
// are skipped silently — they will be marked auth_error and surfaced in the UI later.
func NewWithFactory(database *db.DB, factory AdapterFactory) *Registry {
	r := &Registry{
		adapters: make(map[string]tracker.Adapter),
		database: database,
		factory:  factory,
	}
	_ = r.loadAll(context.Background())
	return r
}

// NewWithAdapters creates a Registry from pre-built adapters (used in tests).
func NewWithAdapters(adapters map[string]tracker.Adapter) *Registry {
	if adapters == nil {
		adapters = make(map[string]tracker.Adapter)
	}
	return &Registry{adapters: adapters}
}

// GetForProject returns a tracker.Client for the project's configured tracker.
// Returns an error if the project has no tracker config assigned, or the config
// exists but its adapter could not be built.
func (r *Registry) GetForProject(ctx context.Context, projectID string) (tracker.Client, error) {
	if r.database == nil {
		return nil, fmt.Errorf("no database wired to registry")
	}
	cfg, err := r.database.GetTrackerConfigForProject(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("lookup tracker config for project %q: %w", projectID, err)
	}
	if cfg == nil {
		return nil, fmt.Errorf("no tracker config assigned to project %q", projectID)
	}
	adapter, err := r.adapterForConfig(cfg.ID)
	if err != nil {
		return nil, err
	}
	scope, err := sourceScope(cfg)
	if err != nil {
		return nil, err
	}
	return &adapterClient{adapter: adapter, projectID: projectID, source: strings.ToLower(cfg.Type), sourceProjectID: scope}, nil
}

// GetAdapterForProjectDirect is like GetForProjectDirect but returns the raw
// tracker.Adapter instead of wrapping it as a tracker.Client. Used by the
// issue-source test endpoint which needs Ping.
func (r *Registry) GetAdapterForProjectDirect(project db.Project) (tracker.Adapter, error) {
	if project.TrackerConfigID != "" {
		cfg, err := r.linkedConfig(project)
		if err != nil {
			return nil, err
		}
		return r.GetAdapter(cfg.ID)
	}
	if project.IssueSourceType == "" {
		return nil, nil
	}
	if r.factory == nil {
		return nil, fmt.Errorf("registry has no adapter factory")
	}
	cfg := &db.TrackerConfig{
		ID:         "project:" + project.ID,
		Type:       project.IssueSourceType,
		Endpoint:   project.IssueSourceEndpoint,
		AuthMethod: "apikey",
	}
	return r.factory(cfg, project.IssueSourceToken)
}

// GitHubAdapterForProject builds an adapter over the project's connected GitHub
// repository. Projects without an explicit issue source use it so their own
// repo issues still appear as work items. token must be a resolved access token.
func (r *Registry) GitHubAdapterForProject(project db.Project, token string) (tracker.Adapter, error) {
	if project.GitHubOwner == "" || project.GitHubRepo == "" || token == "" {
		return nil, nil
	}
	if r.factory == nil {
		return nil, fmt.Errorf("registry has no adapter factory")
	}
	cfg := &db.TrackerConfig{
		ID:         "project-github:" + project.ID,
		Type:       "github",
		Endpoint:   project.GitHubOwner + "/" + project.GitHubRepo,
		AuthMethod: "apikey",
	}
	return r.factory(cfg, token)
}

// GetForProjectDirect builds a tracker.Client directly from the project's embedded
// issue_source_* fields, bypassing the global tracker_configs table entirely.
// Returns (nil, nil) when the project has no issue source configured — callers
// should treat that as "local/sqlite only" and skip external refreshes.
// The project's IssueSourceToken must already be decrypted (GetProjectByID does this).
func (r *Registry) GetForProjectDirect(project db.Project) (tracker.Client, error) {
	if project.TrackerConfigID != "" {
		cfg, err := r.linkedConfig(project)
		if err != nil {
			return nil, err
		}
		adapter, err := r.adapterForConfig(cfg.ID)
		if err != nil {
			return nil, err
		}
		scope, err := sourceScope(cfg)
		if err != nil {
			return nil, err
		}
		return &adapterClient{adapter: adapter, projectID: project.ID, source: strings.ToLower(cfg.Type), sourceProjectID: scope}, nil
	}
	if project.IssueSourceType == "" {
		return nil, nil
	}
	if r.factory == nil {
		return nil, fmt.Errorf("registry has no adapter factory")
	}
	cfg := &db.TrackerConfig{
		ID:         "project:" + project.ID,
		Type:       project.IssueSourceType,
		Endpoint:   project.IssueSourceEndpoint,
		AuthMethod: "apikey",
	}
	adapter, err := r.factory(cfg, project.IssueSourceToken)
	if err != nil {
		return nil, fmt.Errorf("build adapter for project %q (%s): %w", project.ID, project.IssueSourceType, err)
	}
	scope, err := sourceScope(cfg)
	if err != nil {
		return nil, err
	}
	return &adapterClient{adapter: adapter, projectID: project.ID, source: strings.ToLower(cfg.Type), sourceProjectID: scope}, nil
}

// linkedConfig resolves only the tracker config explicitly linked to this
// project. The denormalized issue_source_* columns may be migration backfills;
// when present, type and endpoint must still agree with the linked row.
func (r *Registry) linkedConfig(project db.Project) (*db.TrackerConfig, error) {
	if r.database == nil {
		return nil, errors.New("cannot resolve linked tracker config without a database")
	}
	cfg, err := r.database.GetTrackerConfigForProject(context.Background(), project.ID)
	if err != nil {
		return nil, fmt.Errorf("resolve tracker config linked to project %q: %w", project.ID, err)
	}
	if cfg == nil {
		return nil, fmt.Errorf("project %q references tracker config %q but the database relation is missing", project.ID, project.TrackerConfigID)
	}
	if cfg.ID != project.TrackerConfigID {
		return nil, fmt.Errorf("project %q tracker config identity changed: expected %q, found %q", project.ID, project.TrackerConfigID, cfg.ID)
	}
	if project.IssueSourceType != "" && !strings.EqualFold(project.IssueSourceType, cfg.Type) {
		return nil, fmt.Errorf("project %q issue source type %q conflicts with linked tracker type %q", project.ID, project.IssueSourceType, cfg.Type)
	}
	if project.IssueSourceEndpoint != "" && project.IssueSourceEndpoint != cfg.Endpoint {
		return nil, fmt.Errorf("project %q issue source endpoint conflicts with linked tracker config %q", project.ID, cfg.ID)
	}
	return cfg, nil
}

// GetAdapter returns the raw Adapter for the given config ID (used by browse/viewer endpoints).
func (r *Registry) GetAdapter(configID string) (tracker.Adapter, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[configID]
	if !ok {
		return nil, fmt.Errorf("tracker adapter %q not found", configID)
	}
	return a, nil
}

// Reload re-instantiates the adapter for the given config ID from the database.
// Called after a Settings save so changes take effect without a daemon restart.
// If the config no longer exists (sql.ErrNoRows), the adapter is removed.
// Other DB errors are propagated so callers can distinguish transient failures
// from a real deletion.
func (r *Registry) Reload(ctx context.Context, configID string) error {
	if r.database == nil || r.factory == nil {
		return nil
	}
	cfg, err := r.database.GetTrackerConfig(ctx, configID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			r.mu.Lock()
			delete(r.adapters, configID)
			r.mu.Unlock()
			return nil
		}
		return fmt.Errorf("reload tracker config %q: %w", configID, err)
	}
	a, err := r.buildAdapter(cfg)
	if err != nil {
		return fmt.Errorf("build adapter %q: %w", configID, err)
	}
	r.mu.Lock()
	r.adapters[configID] = a
	r.mu.Unlock()
	return nil
}

// DefaultClient returns a tracker.Client wrapping the first adapter in the registry,
// or nil if no adapters are configured. Used as a backward-compat fallback so the
// orchestrator can keep dispatching against a single global tracker until per-project
// routing is fully wired through every consumer.
func (r *Registry) DefaultClient() tracker.Client {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, a := range r.adapters {
		return &adapterClient{adapter: a}
	}
	return nil
}

// clientForConfig wraps the configID's adapter as a tracker.Client.
func (r *Registry) adapterForConfig(configID string) (tracker.Adapter, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[configID]
	if !ok {
		return nil, fmt.Errorf("tracker adapter %q not loaded (build error or unsupported type)", configID)
	}
	return a, nil
}

func sourceScope(cfg *db.TrackerConfig) (string, error) {
	if cfg == nil {
		return "", errors.New("tracker config missing")
	}
	switch strings.ToLower(cfg.Type) {
	case "github":
		if strings.TrimSpace(cfg.Endpoint) == "" {
			return "", errors.New("github tracker config has no repository scope")
		}
		return strings.TrimSpace(cfg.Endpoint), nil
	case "linear":
		var extra struct {
			TeamKey string `json:"team_key"`
			Team    string `json:"team"`
		}
		_ = json.Unmarshal([]byte(cfg.Extra), &extra)
		scope := strings.TrimSpace(extra.TeamKey)
		if scope == "" {
			scope = strings.TrimSpace(extra.Team)
		}
		endpoint := strings.TrimSpace(cfg.Endpoint)
		if scope == "" && !strings.HasPrefix(strings.ToLower(endpoint), "http://") && !strings.HasPrefix(strings.ToLower(endpoint), "https://") {
			scope = endpoint // legacy configs stored the team key in endpoint
		}
		if scope == "" {
			return "", errors.New("linear tracker config has no confirmed team key")
		}
		return scope, nil
	case "jira":
		var extra struct {
			DefaultProject string `json:"default_project"`
		}
		_ = json.Unmarshal([]byte(cfg.Extra), &extra)
		if strings.TrimSpace(extra.DefaultProject) == "" {
			return "", errors.New("jira tracker config has no confirmed default_project")
		}
		return strings.TrimSpace(extra.DefaultProject), nil
	default:
		return "", nil
	}
}

// loadAll instantiates an adapter for every row in tracker_configs.
func (r *Registry) loadAll(ctx context.Context) error {
	if r.database == nil || r.factory == nil {
		return nil
	}
	configs, err := r.database.ListTrackerConfigs(ctx)
	if err != nil {
		return err
	}
	for i := range configs {
		a, err := r.buildAdapter(&configs[i])
		if err != nil {
			continue
		}
		r.adapters[configs[i].ID] = a
	}
	return nil
}

// buildAdapter decrypts the config's token and runs it through the factory.
// Callers must guarantee r.factory is non-nil (Reload and loadAll both check).
func (r *Registry) buildAdapter(cfg *db.TrackerConfig) (tracker.Adapter, error) {
	token, err := db.DecryptToken(cfg.TokenEnc)
	if err != nil {
		return nil, fmt.Errorf("decrypt token: %w", err)
	}
	return r.factory(cfg, token)
}

// adapterClient wraps a tracker.Adapter to satisfy the tracker.Client interface.
// This is the single seam between the new Adapter-based world and the legacy
// Client-based callers (orchestrator, API handlers, tool executor).
type adapterClient struct {
	adapter         tracker.Adapter
	projectID       string
	source          string
	sourceProjectID string
}

func (c *adapterClient) bind(items []tracker.WorkItem) ([]tracker.WorkItem, error) {
	source := strings.ToLower(c.source)
	for i := range items {
		if c.sourceProjectID != "" {
			if items[i].SourceProjectID != "" && !strings.EqualFold(items[i].SourceProjectID, c.sourceProjectID) {
				return nil, fmt.Errorf("tracker scope conflict: issue %s belongs to %s, selected source scope is %s", items[i].Identifier, items[i].SourceProjectID, c.sourceProjectID)
			}
			if items[i].SourceProjectID == "" && (source == "linear" || source == "jira") {
				return nil, fmt.Errorf("tracker scope unconfirmed: %s issue %s omitted its native project identity", source, items[i].Identifier)
			}
			items[i].SourceProjectID = c.sourceProjectID
		}
		if c.projectID != "" {
			if items[i].ProjectID != "" && items[i].ProjectID != c.projectID {
				return nil, fmt.Errorf("tracker scope conflict: issue %s belongs to local project %s, selected project is %s", items[i].Identifier, items[i].ProjectID, c.projectID)
			}
			items[i].ProjectID = c.projectID
		}
	}
	return items, nil
}

func (c *adapterClient) bindOne(item *tracker.WorkItem, err error) (*tracker.Issue, error) {
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, errors.New("tracker adapter returned an empty issue")
	}
	items, err := c.bind([]tracker.WorkItem{*item})
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func (c *adapterClient) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	items, err := c.adapter.Fetch(ctx, tracker.Filter{States: activeStates})
	if err != nil {
		return nil, err
	}
	return c.bind(items)
}

func (c *adapterClient) FetchIssuesByIDs(ctx context.Context, ids []string) ([]tracker.Issue, error) {
	out := make([]tracker.Issue, 0, len(ids))
	for _, id := range ids {
		item, err := c.adapter.FetchByID(ctx, id)
		if err != nil {
			continue // preserve legacy GitHub omission for individually unavailable IDs
		}
		bound, err := c.bindOne(item, nil)
		if err != nil {
			return nil, err
		}
		out = append(out, *bound)
	}
	return out, nil
}

func (c *adapterClient) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	items, err := c.adapter.Fetch(ctx, tracker.Filter{States: states})
	if err != nil {
		return nil, err
	}
	return c.bind(items)
}

func (c *adapterClient) FetchIssueStatesByIDs(ctx context.Context, ids []string) (map[string]string, error) {
	items, err := c.FetchIssuesByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(items))
	for _, item := range items {
		out[item.ID] = item.State
	}
	return out, nil
}

func (c *adapterClient) FetchIssues(ctx context.Context, filter tracker.IssueFilter) ([]tracker.Issue, error) {
	if filter.ProjectID != "" && c.projectID != "" && filter.ProjectID != c.projectID {
		return nil, fmt.Errorf("requested local project %s does not match selected project %s", filter.ProjectID, c.projectID)
	}
	if source := strings.ToLower(c.source); source == "github" || source == "linear" || source == "jira" {
		filter.ProjectID = ""
	}
	items, err := c.adapter.Fetch(ctx, filter)
	if err != nil {
		return nil, err
	}
	return c.bind(items)
}

func (c *adapterClient) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	items, err := c.adapter.Search(ctx, query)
	if err != nil {
		return nil, err
	}
	return c.bind(items)
}

func (c *adapterClient) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	return c.bindOne(c.adapter.FetchByID(ctx, identifier))
}

func (c *adapterClient) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID, provider string, disabledTools []string) (*tracker.Issue, error) {
	if projectID != "" && c.projectID != "" && projectID != c.projectID {
		return nil, fmt.Errorf("requested local project %s does not match selected project %s", projectID, c.projectID)
	}
	localProjectID := projectID
	if c.projectID != "" {
		localProjectID = c.projectID
	}
	adapterProjectID := localProjectID
	if source := strings.ToLower(c.source); source == "github" || source == "linear" || source == "jira" {
		adapterProjectID = ""
	}
	item := tracker.WorkItem{
		Title:           title,
		Description:     description,
		State:           state,
		Priority:        priority,
		AssigneeID:      assigneeID,
		ProjectID:       adapterProjectID,
		SourceProjectID: c.sourceProjectID,
		Provider:        provider,
		DisabledTools:   disabledTools,
	}
	return c.bindOne(c.adapter.Create(ctx, item))
}

func (c *adapterClient) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	if _, err := c.FetchIssueByIdentifier(ctx, identifier); err != nil {
		return nil, fmt.Errorf("refusing hosted update before selected source scope is confirmed: %w", err)
	}
	return c.bindOne(c.adapter.Update(ctx, identifier, updates))
}

func (c *adapterClient) DeleteIssue(ctx context.Context, identifier string) error {
	if _, err := c.FetchIssueByIdentifier(ctx, identifier); err != nil {
		return fmt.Errorf("refusing hosted delete before selected source scope is confirmed: %w", err)
	}
	return c.adapter.Delete(ctx, identifier)
}

// AddAssignee forwards an optional additive assignment capability without
// widening tracker.Client for sources that do not support it.
func (c *adapterClient) AddAssignee(ctx context.Context, identifier, assigneeID string) (*tracker.Issue, error) {
	capability, ok := c.adapter.(interface {
		AddAssignee(context.Context, string, string) (*tracker.Issue, error)
	})
	if !ok {
		return nil, fmt.Errorf("tracker %s does not support additive assignee updates", c.source)
	}
	return c.bindOne(capability.AddAssignee(ctx, identifier, assigneeID))
}
