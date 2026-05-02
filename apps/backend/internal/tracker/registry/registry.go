// Package registry holds the TrackerRegistry — a runtime collection of tracker
// adapter instances keyed by config ID, routing per-project lookups to the right backend.
package registry

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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
	return r.clientForConfig(cfg.ID)
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
func (r *Registry) clientForConfig(configID string) (tracker.Client, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[configID]
	if !ok {
		return nil, fmt.Errorf("tracker adapter %q not loaded (build error or unsupported type)", configID)
	}
	return &adapterClient{adapter: a}, nil
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
	adapter tracker.Adapter
}

func (c *adapterClient) FetchCandidateIssues(ctx context.Context, activeStates []string) ([]tracker.Issue, error) {
	return c.adapter.Fetch(ctx, tracker.Filter{States: activeStates})
}

func (c *adapterClient) FetchIssuesByIDs(ctx context.Context, ids []string) ([]tracker.Issue, error) {
	out := make([]tracker.Issue, 0, len(ids))
	for _, id := range ids {
		item, err := c.adapter.FetchByID(ctx, id)
		if err != nil {
			continue // skip individual failures; matches existing GitHub client behaviour
		}
		out = append(out, *item)
	}
	return out, nil
}

func (c *adapterClient) FetchIssuesByStates(ctx context.Context, states []string) ([]tracker.Issue, error) {
	return c.adapter.Fetch(ctx, tracker.Filter{States: states})
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
	// IssueFilter is a type alias for Filter — pass through directly.
	return c.adapter.Fetch(ctx, filter)
}

func (c *adapterClient) SearchIssues(ctx context.Context, query string) ([]tracker.Issue, error) {
	return c.adapter.Search(ctx, query)
}

func (c *adapterClient) FetchIssueByIdentifier(ctx context.Context, identifier string) (*tracker.Issue, error) {
	return c.adapter.FetchByID(ctx, identifier)
}

func (c *adapterClient) CreateIssue(ctx context.Context, title, description, state string, priority int, assigneeID, projectID, provider string, disabledTools []string) (*tracker.Issue, error) {
	item := tracker.WorkItem{
		Title:         title,
		Description:   description,
		State:         state,
		Priority:      priority,
		AssigneeID:    assigneeID,
		ProjectID:     projectID,
		Provider:      provider,
		DisabledTools: disabledTools,
	}
	return c.adapter.Create(ctx, item)
}

func (c *adapterClient) UpdateIssue(ctx context.Context, identifier string, updates map[string]any) (*tracker.Issue, error) {
	return c.adapter.Update(ctx, identifier, updates)
}

func (c *adapterClient) DeleteIssue(ctx context.Context, identifier string) error {
	return c.adapter.Delete(ctx, identifier)
}
