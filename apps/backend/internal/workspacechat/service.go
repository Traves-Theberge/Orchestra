// Package workspacechat provides project-scoped CLI conversations. Each turn
// uses durable native threads when available, with explicit replay fallback.
package workspacechat

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/agentcatalog"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

const Mode = "transcript_replay"

// OrchestratorScope is a durable conversation scope, never a catalog project.
const OrchestratorScope = "__orchestrator__"
const maxText = 64 * 1024

// replayBudget bounds a command harness's replayed transcript. The prompt is
// passed as one shell argument, and Windows caps a command line at 32K chars.
const replayBudget = 24 * 1024

var ErrBusy = errors.New("conversation has an active or unsettled turn or delivery")
var ErrNotFound = errors.New("conversation not found in this project")
var ErrInvalid = errors.New("invalid chat request")
var ErrForbidden = errors.New("project path is not authorized or unavailable")
var ErrUnsupported = errors.New("provider or options unavailable")
var ErrConflict = errors.New("conversation identity is already bound to another project or provider")
var ErrTitleConflict = errors.New("conversation title changed; refresh before renaming")

type CreateRequest struct {
	Provider                  string `json:"provider"`
	Title                     string `json:"title"`
	ClientSessionID           string `json:"client_session_id,omitempty"`
	RequestedModel            string `json:"requested_model,omitempty"`
	RequestedReasoningEffort  string `json:"requested_reasoning_effort,omitempty"`
	RequestedAgentID          string `json:"agent_id,omitempty"`
	RequestedAgentScope       string `json:"agent_scope,omitempty"`
	RequestedAgentContentHash string `json:"agent_content_hash,omitempty"`
	RequestedAgentFormat      string `json:"agent_format,omitempty"`
}

type Registry interface {
	HasProvider(agents.Provider) bool
	ValidateTurnOptions(agents.Provider, agents.TurnRequest) error
	RunTurn(context.Context, agents.Provider, agents.TurnRequest, agents.EventHandler) (agents.TurnResult, error)
}
type Provider struct {
	ID               string `json:"id"`
	Label            string `json:"label"`
	Enabled          bool   `json:"enabled"`
	Reason           string `json:"reason,omitempty"`
	ConversationMode string `json:"conversation_mode"`
	ProviderResume   bool   `json:"provider_resume"`
}
type Session struct {
	AccountID                 string `json:"account_id,omitempty"`
	ID                        string `json:"id"`
	ProjectID                 string `json:"project_id"`
	WorkspaceID               string `json:"workspace_id,omitempty"`
	WorkspacePath             string `json:"workspace_path,omitempty"`
	Provider                  string `json:"provider"`
	Title                     string `json:"title"`
	Status                    string `json:"status"`
	ConversationMode          string `json:"conversation_mode"`
	CreatedAt                 string `json:"created_at"`
	UpdatedAt                 string `json:"updated_at"`
	Error                     string `json:"error,omitempty"`
	ProviderThreadID          string `json:"provider_thread_id,omitempty"`
	RequestedModel            string `json:"requested_model,omitempty"`
	EffectiveModel            string `json:"effective_model,omitempty"`
	ApprovalPolicy            string `json:"approval_policy,omitempty"`
	SandboxMode               string `json:"sandbox_mode,omitempty"`
	RequestedReasoningEffort  string `json:"requested_reasoning_effort,omitempty"`
	EffectiveReasoningEffort  string `json:"effective_reasoning_effort,omitempty"`
	Archived                  bool   `json:"archived"`
	ArchivedAt                string `json:"archived_at,omitempty"`
	LifecycleVersion          int64  `json:"lifecycle_version"`
	RequestedAgentID          string `json:"requested_agent_id,omitempty"`
	RequestedAgentScope       string `json:"requested_agent_scope,omitempty"`
	RequestedAgentContentHash string `json:"requested_agent_content_hash,omitempty"`
	RequestedAgentFormat      string `json:"requested_agent_format,omitempty"`
	EffectiveAgentID          string `json:"effective_agent_id,omitempty"`
	AgentObservation          string `json:"agent_observation,omitempty"`
	// PendingRequests counts runtime requests (approvals, questions) waiting on
	// the user during a running turn, so session lists can show "needs input".
	PendingRequests int `json:"pending_requests,omitempty"`
}
type Message struct {
	ID                        string `json:"id"`
	SessionID                 string `json:"session_id"`
	Role                      string `json:"role"`
	Text                      string `json:"text"`
	Status                    string `json:"status"`
	ClientMessageID           string `json:"client_message_id,omitempty"`
	CreatedAt                 string `json:"created_at"`
	RequestedAgentID          string `json:"requested_agent_id,omitempty"`
	RequestedAgentScope       string `json:"requested_agent_scope,omitempty"`
	RequestedAgentContentHash string `json:"requested_agent_content_hash,omitempty"`
	RequestedAgentFormat      string `json:"requested_agent_format,omitempty"`
	EffectiveAgentID          string `json:"effective_agent_id,omitempty"`
	AgentObservation          string `json:"agent_observation,omitempty"`
	Provider                  string `json:"provider,omitempty"`
	// Agent provenance: the agent the message was sent with (user) or
	// produced under (assistant).
	AgentID    string `json:"agent_id,omitempty"`
	AgentName  string `json:"agent_name,omitempty"`
	AgentColor string `json:"agent_color,omitempty"`
}
type Detail struct {
	Session  Session          `json:"session"`
	Messages []Message        `json:"messages"`
	Events   []ChatEvent      `json:"events"`
	Requests []RuntimeRequest `json:"requests"`
	Cursor   int64            `json:"cursor"`
}
type SendRequest struct {
	ClientMessageID           string `json:"client_message_id"`
	Text                      string `json:"text"`
	RequestedModel            string `json:"requested_model,omitempty"`
	RequestedMaxTurns         *int   `json:"requested_max_turns,omitempty"`
	RequestedReasoningEffort  string `json:"requested_reasoning_effort,omitempty"`
	RequestedAgentID          string `json:"agent_id,omitempty"`
	RequestedAgentScope       string `json:"agent_scope,omitempty"`
	RequestedAgentContentHash string `json:"agent_content_hash,omitempty"`
	RequestedAgentFormat      string `json:"agent_format,omitempty"`
}
type Accepted struct {
	Session Session `json:"session"`
	Message Message `json:"message"`
}
type Service struct {
	db                   *db.DB
	registry             Registry
	roots                []string
	mu                   sync.Mutex
	active               map[string]context.CancelFunc
	closed               bool
	wg                   sync.WaitGroup
	native               map[string]agents.NativeSession
	nativeFailures       sync.Map
	nativePrefixes       map[string]string
	orchestratorRoot     string
	orchestratorTools    []map[string]any
	orchestratorExecutor agents.ToolExecutor
	agentCatalog         *agentcatalog.Service
	mcpSource            MCPSource
	nativeAgents         map[string]string
}

// New recovers incomplete deliveries as unknown; it never resubmits them.
func New(database *db.DB, registry Registry, roots []string) (*Service, error) {
	if database == nil || registry == nil {
		return nil, fmt.Errorf("workspace chat dependencies unavailable")
	}
	_, err := database.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, provider TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS workspace_chat_messages (ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL, session_id TEXT NOT NULL, role TEXT NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL,client_message_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS workspace_chat_submission ON workspace_chat_messages(session_id,client_message_id) WHERE client_message_id <> '';`)
	if err != nil {
		return nil, err
	}
	if err = migrateNative(database); err != nil {
		return nil, err
	}
	if err = migrateAgentProfiles(database); err != nil {
		return nil, err
	}
	if err = migrateHarnessSwitch(database); err != nil {
		return nil, err
	}
	// The inline HTML fence was renamed to orchestra-html; keep earlier
	// conversations rendering.
	if _, err = database.Exec(`UPDATE workspace_chat_messages SET text=REPLACE(text,'t3-html','orchestra-html') WHERE instr(text,'t3-html')>0;
	 UPDATE workspace_chat_events SET event=REPLACE(event,'t3-html','orchestra-html') WHERE instr(event,'t3-html')>0;`); err != nil {
		return nil, err
	}
	if _, err = database.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_workspaces(session_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, cwd TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workspace_chat_workspace_scope ON workspace_chat_workspaces(workspace_id);`); err != nil {
		return nil, err
	}
	if _, err = database.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_creation_options(session_id TEXT PRIMARY KEY, requested_model TEXT NOT NULL, effort TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_chat_submission_inputs(message_id TEXT PRIMARY KEY, requested_model TEXT NOT NULL, effort TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_chat_agent_selection(session_id TEXT PRIMARY KEY, requested_agent_id TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '', effective_agent_id TEXT NOT NULL DEFAULT '', observation TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS workspace_chat_submission_agents(message_id TEXT PRIMARY KEY, requested_agent_id TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '');`); err != nil {
		return nil, err
	}
	if _, err = database.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_lifecycle(session_id TEXT PRIMARY KEY, archived_at TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0);`); err != nil {
		return nil, err
	}
	if _, err = database.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_account_bindings(session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workspace_chat_account_ref ON workspace_chat_account_bindings(account_id);`); err != nil {
		return nil, err
	}
	tx, err := database.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`UPDATE workspace_chat_messages SET status='unknown' WHERE status='accepted'`); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(`UPDATE workspace_chat_sessions SET status='interrupted',error='Backend restarted; delivery outcome unknown. Inspect before sending again.' WHERE status IN ('running','stopping')`); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return &Service{db: database, registry: registry, roots: append([]string(nil), roots...), active: map[string]context.CancelFunc{}, native: map[string]agents.NativeSession{}, nativePrefixes: map[string]string{}, nativeAgents: map[string]string{}}, nil
}

// ConfigureAgentCatalog installs the single scoped catalog used to validate
// requested primary-agent identities before session or message acceptance.
func (s *Service) ConfigureAgentCatalog(catalog *agentcatalog.Service) {
	s.agentCatalog = catalog
}
func stamp() string { return time.Now().UTC().Format(time.RFC3339Nano) }
func (s *Service) registeredRoot(ctx context.Context, projectID string) (string, error) {
	if projectID == OrchestratorScope {
		if s.orchestratorRoot == "" {
			return "", ErrForbidden
		}
		root, err := filepath.EvalSymlinks(s.orchestratorRoot)
		if err != nil || root != s.orchestratorRoot {
			return "", ErrForbidden
		}
		return root, nil
	}
	p, err := s.db.GetProjectByID(ctx, projectID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", err
	}
	if !filepath.IsAbs(p.RootPath) {
		return "", ErrForbidden
	}
	root, err := filepath.EvalSymlinks(p.RootPath)
	if err != nil {
		return "", ErrForbidden
	}
	if err = workspace.ValidateProjectPath(root, s.roots); err != nil {
		return "", ErrForbidden
	}
	st, err := os.Stat(root)
	if err != nil || !st.IsDir() {
		return "", ErrForbidden
	}
	return root, nil
}
func (s *Service) Providers(ctx context.Context, pid string) ([]Provider, error) {
	if _, err := s.root(ctx, pid); err != nil {
		return nil, err
	}
	result := []Provider{}
	choices := []struct {
		id    agents.Provider
		label string
	}{
		{agents.ProviderCodex, "Codex"},
		{agents.ProviderClaude, "Claude Code"},
		{agents.ProviderOpenCode, "OpenCode"},
		{agents.ProviderAntigravity, "Antigravity"},
		{agents.Provider8gent, "8gent"},
	}
	known := map[agents.Provider]bool{
		agents.ProviderCodex:       true,
		agents.ProviderClaude:      true,
		agents.ProviderOpenCode:    true,
		agents.ProviderAntigravity: true,
		agents.Provider8gent:       true,
	}
	if catalog, ok := s.registry.(interface{ Providers() []agents.Provider }); ok {
		registered := catalog.Providers()
		sort.Slice(registered, func(i, j int) bool { return registered[i] < registered[j] })
		for _, id := range registered {
			if known[id] {
				continue
			}
			choices = append(choices, struct {
				id    agents.Provider
				label string
			}{id, string(id)})
		}
	}
	for _, p := range choices {
		enabled := s.registry.HasProvider(p.id)
		reason := ""
		if !enabled {
			reason = "CLI provider is not configured"
		} else if err := s.registry.ValidateTurnOptions(p.id, agents.TurnRequest{RuntimeTarget: agents.RuntimeLocal}); err != nil {
			enabled = false
			reason = "CLI provider cannot execute a local turn"
		}
		mode, resume := Mode, false
		if s.supportsNative(p.id) {
			mode, resume = "native_session", true
		}
		result = append(result, Provider{string(p.id), p.label, enabled, reason, mode, resume})
	}
	return result, nil
}
func (s *Service) Create(ctx context.Context, pid, provider, title string) (Session, error) {
	return s.CreateWithRequest(ctx, pid, CreateRequest{Provider: provider, Title: title})
}
func (s *Service) createWithRequest(ctx context.Context, pid string, req CreateRequest) (Session, error) {
	provider, title := req.Provider, req.Title
	identity := req.ClientSessionID
	if identity != "" {
		parsed, err := uuid.Parse(identity)
		if err != nil || parsed == uuid.Nil || len(identity) != 36 || parsed.String() != strings.ToLower(identity) {
			return Session{}, ErrInvalid
		}
		identity = parsed.String()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return Session{}, fmt.Errorf("chat service shutting down")
	}
	workspaceID, cwd, _, err := s.scope(ctx, pid)
	if err != nil {
		return Session{}, err
	}
	p := agents.NormalizeProvider(provider)
	if identity != "" {
		existing, err := scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE id=?`, identity))
		if err == nil {
			if existing.ProjectID != pid || existing.Provider != string(p) {
				return Session{}, ErrConflict
			}
			if err = s.validateSessionScope(ctx, &existing); err != nil {
				return Session{}, ErrConflict
			}
			if err = s.matchCreationOptions(ctx, existing.ID, req); err != nil {
				return Session{}, err
			}
			if err = s.decorate(ctx, &existing); err != nil {
				return Session{}, err
			}
			if err = decorateLifecycle(ctx, s.db, &existing); err != nil {
				return Session{}, err
			}
			return existing, nil
		}
		if !errors.Is(err, ErrNotFound) {
			return Session{}, err
		}
	}
	if !s.registry.HasProvider(p) {
		return Session{}, ErrUnsupported
	}
	if err := s.registry.ValidateTurnOptions(p, agents.TurnRequest{RuntimeTarget: agents.RuntimeLocal}); err != nil {
		return Session{}, fmt.Errorf("%w: %s", ErrUnsupported, err)
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = s.defaultTitle(ctx, pid, workspaceID)
	}
	if !utf8.ValidString(title) || utf8.RuneCountInString(title) > 200 {
		return Session{}, ErrInvalid
	}
	now := stamp()
	if identity == "" {
		identity = uuid.NewString()
	}
	sess := Session{ID: identity, ProjectID: pid, WorkspaceID: workspaceID, WorkspacePath: cwd, Provider: string(p), Title: title, Status: "idle", ConversationMode: Mode, CreatedAt: now, UpdatedAt: now}
	sess.AccountID = "system_default"
	if selector, ok := s.registry.(interface{ ActiveAccount(agents.Provider) string }); ok {
		if selected := selector.ActiveAccount(p); selected != "" {
			sess.AccountID = selected
		}
	}
	sess.RequestedAgentID = req.RequestedAgentID
	sess.RequestedAgentScope = req.RequestedAgentScope
	sess.RequestedAgentContentHash = req.RequestedAgentContentHash
	sess.RequestedAgentFormat = req.RequestedAgentFormat
	if req.RequestedAgentID != "" {
		sess.AgentObservation = "requested_unobserved"
	}
	if s.supportsNative(p) {
		sess.ConversationMode = "native_session"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_chat_lifecycle(session_id) VALUES(?)`, sess.ID); err != nil {
		return Session{}, err
	}
	if err = rejectPendingRemoval(ctx, tx, pid, workspaceID, cwd); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_sessions(id,project_id,provider,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, sess.ID, pid, sess.Provider, title, sess.Status, now, now); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_account_bindings(session_id,account_id) VALUES(?,?)`, sess.ID, sess.AccountID); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_modes(session_id,mode) VALUES(?,?)`, sess.ID, sess.ConversationMode); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_workspaces(session_id,workspace_id,cwd) VALUES(?,?,?)`, sess.ID, workspaceID, cwd); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_creation_options(session_id,requested_model,effort) VALUES(?,?,?)`, sess.ID, req.RequestedModel, req.RequestedReasoningEffort); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_agent_selection(session_id,requested_agent_id,scope,content_hash,format,effective_agent_id,observation) VALUES(?,?,?,?,?,'',?)`, sess.ID, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat, sess.AgentObservation); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_native(session_id,requested_model) VALUES(?,?)`, sess.ID, req.RequestedModel); err != nil {
		return Session{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_efforts(session_id,requested) VALUES(?,?)`, sess.ID, req.RequestedReasoningEffort); err != nil {
		return Session{}, err
	}
	sess.RequestedModel, sess.RequestedReasoningEffort = req.RequestedModel, req.RequestedReasoningEffort
	return sess, tx.Commit()
}
func scanSession(row interface{ Scan(...any) error }) (Session, error) {
	var v Session
	v.ConversationMode = Mode
	err := row.Scan(&v.ID, &v.ProjectID, &v.Provider, &v.Title, &v.Status, &v.CreatedAt, &v.UpdatedAt, &v.Error)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return v, err
}

const sessionFields = "id,project_id,provider,title,status,created_at,updated_at,error"

func (s *Service) List(ctx context.Context, pid string) ([]Session, error) {
	return s.ListWithArchived(ctx, pid, false)
}

// ListWithArchived returns sessions bound to the selected live checkout. The
// normal chat list hides archived conversations; explicit history surfaces opt in.
func (s *Service) ListWithArchived(ctx context.Context, pid string, includeArchived bool) ([]Session, error) {
	workspaceID, _, primary, err := s.scope(ctx, pid)
	if err != nil {
		return nil, err
	}
	query := `SELECT ` + sessionFields + ` FROM workspace_chat_sessions WHERE project_id=? AND (id IN (SELECT session_id FROM workspace_chat_workspaces WHERE workspace_id=?) OR (? AND id NOT IN (SELECT session_id FROM workspace_chat_workspaces)))`
	if !includeArchived {
		query += ` AND NOT EXISTS (SELECT 1 FROM workspace_chat_lifecycle l WHERE l.session_id=workspace_chat_sessions.id AND l.archived_at<>'')`
	}
	query += ` ORDER BY created_at DESC`
	rows, err := s.db.QueryContext(ctx, query, pid, workspaceID, primary)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Session{}
	for rows.Next() {
		v, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, v)
	}
	err = rows.Err()
	rows.Close()
	for i := range result {
		if e := s.validateSessionScope(ctx, &result[i]); e != nil {
			return nil, e
		}
		if e := s.decorate(ctx, &result[i]); e != nil {
			return nil, e
		}
		if e := decorateLifecycle(ctx, s.db, &result[i]); e != nil {
			return nil, e
		}
	}
	return result, err
}
func (s *Service) Detail(ctx context.Context, pid, id string) (Detail, error) {
	return s.DetailAfter(ctx, pid, id, 0)
}
func (s *Service) DetailAfter(ctx context.Context, pid, id string, after int64) (Detail, error) {
	if after < 0 {
		return Detail{}, ErrInvalid
	}
	if _, err := s.root(ctx, pid); err != nil {
		return Detail{}, err
	}
	v, err := scanSession(s.db.QueryRowContext(ctx, `SELECT `+sessionFields+` FROM workspace_chat_sessions WHERE project_id=? AND id=?`, pid, id))
	if err != nil {
		return Detail{}, err
	}
	if err = s.validateSessionScope(ctx, &v); err != nil {
		return Detail{}, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT m.id,m.session_id,m.role,m.text,m.status,m.client_message_id,m.created_at,COALESCE(a.requested_agent_id,''),COALESCE(a.scope,''),COALESCE(a.content_hash,''),COALESCE(a.format,''),COALESCE(mp.provider,''),COALESCE(ma.agent_id,''),COALESCE(ma.agent_name,''),COALESCE(ma.agent_color,'') FROM workspace_chat_messages m LEFT JOIN workspace_chat_submission_agents a ON a.message_id=m.id LEFT JOIN workspace_chat_message_providers mp ON mp.message_id=m.id LEFT JOIN workspace_chat_message_agents ma ON ma.message_id=m.id WHERE m.session_id=? ORDER BY m.ordinal`, id)
	if err != nil {
		return Detail{}, err
	}
	defer rows.Close()
	result := Detail{Session: v, Messages: []Message{}}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.SessionID, &m.Role, &m.Text, &m.Status, &m.ClientMessageID, &m.CreatedAt, &m.RequestedAgentID, &m.RequestedAgentScope, &m.RequestedAgentContentHash, &m.RequestedAgentFormat, &m.Provider, &m.AgentID, &m.AgentName, &m.AgentColor); err != nil {
			return Detail{}, err
		}
		if m.Provider == "" {
			m.Provider = v.Provider
		}
		if m.RequestedAgentID != "" {
			m.AgentObservation = "requested_unobserved"
		}
		result.Messages = append(result.Messages, m)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Detail{}, err
	}
	if err = s.decorate(ctx, &result.Session); err != nil {
		return Detail{}, err
	}
	if err = decorateLifecycle(ctx, s.db, &result.Session); err != nil {
		return Detail{}, err
	}
	if err = s.loadNative(ctx, &result, after); err != nil {
		return Detail{}, err
	}
	return result, nil
}
func (s *Service) Send(ctx context.Context, pid, id string, req SendRequest) (Accepted, error) {
	return s.send(ctx, pid, id, req, "", "")
}
func (s *Service) send(ctx context.Context, pid, id string, req SendRequest, validatedRoot, validatedModel string) (Accepted, error) {
	inputModel, inputEffort := req.RequestedModel, req.RequestedReasoningEffort
	if strings.TrimSpace(req.Text) == "" || len(req.Text) > maxText || strings.TrimSpace(req.ClientMessageID) == "" || len(req.ClientMessageID) > 200 {
		return Accepted{}, ErrInvalid
	}
	s.mu.Lock()
	locked := true
	defer func() {
		if locked {
			s.mu.Unlock()
		}
	}()
	if s.closed {
		return Accepted{}, fmt.Errorf("chat service shutting down")
	}
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		return Accepted{}, err
	}
	if d.Session.Archived {
		return Accepted{}, ErrNotFound
	}
	// An idempotent replay never runs again, even after failure or restart.
	for _, m := range d.Messages {
		if m.ClientMessageID == req.ClientMessageID {
			var requestedModel string
			var requestedEffort string
			e := s.db.QueryRowContext(ctx, `SELECT requested_model FROM workspace_chat_submissions WHERE message_id=?`, m.ID).Scan(&requestedModel)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return Accepted{}, e
			}
			e = s.db.QueryRowContext(ctx, `SELECT effort FROM workspace_chat_submission_efforts WHERE message_id=?`, m.ID).Scan(&requestedEffort)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return Accepted{}, e
			}
			e = s.db.QueryRowContext(ctx, `SELECT requested_model,effort FROM workspace_chat_submission_inputs WHERE message_id=?`, m.ID).Scan(&requestedModel, &requestedEffort)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return Accepted{}, e
			}
			var agentID, agentScope, agentHash, agentFormat string
			e = s.db.QueryRowContext(ctx, `SELECT requested_agent_id,scope,content_hash,format FROM workspace_chat_submission_agents WHERE message_id=?`, m.ID).Scan(&agentID, &agentScope, &agentHash, &agentFormat)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return Accepted{}, e
			}
			if m.Text != req.Text || req.RequestedModel != requestedModel || req.RequestedReasoningEffort != requestedEffort || req.RequestedAgentID != agentID || req.RequestedAgentScope != agentScope || req.RequestedAgentContentHash != agentHash || req.RequestedAgentFormat != agentFormat || req.RequestedMaxTurns != nil {
				return Accepted{}, ErrInvalid
			}
			return Accepted{d.Session, m}, nil
		}
	}
	if accountRegistry, ok := s.registry.(interface {
		ValidateAccount(agents.Provider, string) error
	}); ok {
		if err := accountRegistry.ValidateAccount(agents.Provider(d.Session.Provider), d.Session.AccountID); err != nil {
			return Accepted{}, fmt.Errorf("%w: bound account is no longer available", ErrUnsupported)
		}
	}
	// A fresh send can choose a different primary profile or return to the
	// provider default. The accepted message freezes that exact choice below;
	// replays are checked against the per-message record above.
	if req.RequestedModel == "" {
		req.RequestedModel = d.Session.RequestedModel
	}
	if req.RequestedReasoningEffort == "" {
		req.RequestedReasoningEffort = d.Session.RequestedReasoningEffort
	}
	if d.Session.Provider == string(agents.ProviderAntigravity) && d.Session.ConversationMode == "native_session" {
		// AGY pins configuration to its process. Reject a known unsupported
		// change before recording a submission, rather than labeling an
		// undispatched message as an uncertain provider delivery.
		if req.RequestedReasoningEffort != "" || d.Session.ProviderThreadID != "" &&
			d.Session.EffectiveModel != "" && req.RequestedModel != "" && req.RequestedModel != d.Session.EffectiveModel {
			return Accepted{}, fmt.Errorf("%w: Antigravity configuration changes require a new conversation", ErrUnsupported)
		}
	}
	var resolvedAgent *agents.ResolvedAgent
	if req.RequestedAgentID != "" {
		if resolvedAgent, err = s.resolveAgentIntent(ctx, pid, d.Session.Provider, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat); err != nil {
			return Accepted{}, err
		}
	} else if hasAgentIntent(req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat) {
		return Accepted{}, ErrInvalid
	}
	if _, ok := s.active[id]; ok {
		return Accepted{}, ErrBusy
	}
	if d.Session.Status == "running" || d.Session.Status == "stopping" {
		return Accepted{}, ErrBusy
	}
	// Project and worktree chats serialize turns per checkout, including
	// persisted ownership whose process is unknown, so two agents never edit
	// the same checkout at once; independent worktree chats still run in
	// parallel. Maestro conversations all share one checkout but are meant to
	// work anywhere, so Maestro is concurrent per session (one turn per
	// session). Trade-off: concurrent Maestro agents can edit the same files.
	// The service mutex covers this check through durable acceptance.
	if pid != OrchestratorScope {
		var occupied int
		_, _, primary, scopeErr := s.scope(ctx, pid)
		if scopeErr != nil {
			return Accepted{}, scopeErr
		}
		if err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workspace_chat_sessions WHERE project_id=? AND status IN ('running','stopping') AND (id IN (SELECT session_id FROM workspace_chat_workspaces WHERE workspace_id=?) OR (? AND id NOT IN (SELECT session_id FROM workspace_chat_workspaces)))`, pid, d.Session.WorkspaceID, primary).Scan(&occupied); err != nil {
			return Accepted{}, err
		}
		if occupied > 0 {
			return Accepted{}, ErrBusy
		}
	}
	root, err := s.root(ctx, pid)
	if err != nil {
		return Accepted{}, err
	}
	turn := agents.TurnRequest{SessionID: uuid.NewString(), ProjectID: pid, Workspace: root, WorkspaceRoot: root, ProjectRootWorkspace: true, Prompt: req.Text, Timeout: turnTimeout(ctx), RuntimeTarget: agents.RuntimeLocal, RequestedModel: req.RequestedModel, RequestedMaxTurns: req.RequestedMaxTurns, RequestedAgentID: req.RequestedAgentID, RequestedAgentScope: req.RequestedAgentScope, RequestedAgentContentHash: req.RequestedAgentContentHash, RequestedAgentFormat: req.RequestedAgentFormat}
	turn.AccountID = d.Session.AccountID
	turn.StreamReasoning = true
	turn.Agent = resolvedAgent
	if turn.MCPServers, err = s.runMCPServers(ctx, resolvedAgent); err != nil {
		return Accepted{}, err
	}
	if pid == OrchestratorScope {
		if s.supportsControl(agents.Provider(d.Session.Provider)) {
			turn.ToolSpecs = s.orchestratorTools
			turn.ToolExecutor = s.orchestratorExecutor
		}
		turn.DeveloperInstructions, err = maestroInstructions(root)
		if err != nil {
			return Accepted{}, err
		}
	} else {
		turn.DeveloperInstructions = visualInstructions
	}
	if req.RequestedMaxTurns != nil {
		return Accepted{}, ErrUnsupported
	}
	nativeMode := d.Session.ConversationMode == "native_session"
	if nativeMode && !s.supportsNative(agents.Provider(d.Session.Provider)) {
		return Accepted{}, ErrUnsupported
	}
	if req.RequestedReasoningEffort != "" {
		if !nativeMode || len(req.RequestedReasoningEffort) > 32 {
			return Accepted{}, ErrUnsupported
		}
		model := req.RequestedModel
		if model == "" {
			return Accepted{}, fmt.Errorf("%w: select a model before choosing reasoning effort", ErrUnsupported)
		}
		if validatedRoot != "" {
			if validatedRoot != root || validatedModel != model {
				return Accepted{}, ErrBusy
			}
		} else {
			s.mu.Unlock()
			locked = false
			if err = s.validateEffort(ctx, pid, d.Session.Provider, d.Session.AccountID, model, req.RequestedReasoningEffort); err != nil {
				return Accepted{}, err
			}
			req.RequestedModel, req.RequestedReasoningEffort = inputModel, inputEffort
			return s.send(ctx, pid, id, req, root, model)
		}
	}
	if !nativeMode {
		if err = s.registry.ValidateTurnOptions(agents.Provider(d.Session.Provider), turn); err != nil {
			return Accepted{}, fmt.Errorf("%w: %s", ErrUnsupported, err)
		}
	}
	agentSwitch := false
	if nativeMode {
		from, pending, e := s.handoffPending(ctx, id)
		if e != nil {
			return Accepted{}, e
		}
		// Native threads pin the agent profile (thread instructions, agy
		// --agent). Switching agents mid-conversation starts a fresh provider
		// thread seeded with the provider-neutral transcript.
		threadKey, e := s.threadAgentKey(ctx, id)
		if e != nil {
			return Accepted{}, e
		}
		agentSwitch = d.Session.ProviderThreadID != "" && threadKey != agentKey(resolvedAgent)
		if pending {
			turn.Prompt = handoffTranscript(d.Messages, from, d.Session.Provider, req.Text, maxText)
		} else if agentSwitch {
			turn.Prompt = agentHandoffTranscript(d.Messages, resolvedAgent, req.Text, maxText)
		}
	}
	if !nativeMode {
		turn.Prompt = replayTranscript("This is a new provider turn with Orchestra conversation transcript replay, not native session resume. Work only in the selected project. Previous messages follow as conversation context.\n", d.Messages, req.Text, replayBudget)
	}
	m := Message{ID: uuid.NewString(), SessionID: id, Role: "user", Text: req.Text, Status: "accepted", ClientMessageID: req.ClientMessageID, CreatedAt: stamp(), RequestedAgentID: req.RequestedAgentID, RequestedAgentScope: req.RequestedAgentScope, RequestedAgentContentHash: req.RequestedAgentContentHash, RequestedAgentFormat: req.RequestedAgentFormat}
	if req.RequestedAgentID != "" {
		m.AgentObservation = "requested_unobserved"
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Accepted{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_chat_lifecycle(session_id) VALUES(?)`, id); err != nil {
		return Accepted{}, err
	}
	var archivedAt string
	if err = tx.QueryRowContext(ctx, `SELECT archived_at FROM workspace_chat_lifecycle WHERE session_id=?`, id).Scan(&archivedAt); err != nil {
		return Accepted{}, err
	}
	if archivedAt != "" {
		return Accepted{}, ErrNotFound
	}
	if err = rejectPendingRemoval(ctx, tx, pid, d.Session.WorkspaceID, d.Session.WorkspacePath); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_workspaces(session_id,workspace_id,cwd) VALUES(?,?,?) ON CONFLICT(session_id) DO NOTHING`, id, d.Session.WorkspaceID, d.Session.WorkspacePath); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_messages(id,session_id,role,text,status,client_message_id,created_at) VALUES(?,?,?,?,?,?,?)`, m.ID, id, m.Role, m.Text, m.Status, m.ClientMessageID, m.CreatedAt); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE workspace_chat_sessions SET status='running',updated_at=?,error='' WHERE id=?`, m.CreatedAt, id); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_message_providers(message_id,provider) VALUES(?,?)`, m.ID, d.Session.Provider); err != nil {
		return Accepted{}, err
	}
	m.Provider = d.Session.Provider
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_submissions(message_id,requested_model) VALUES(?,?)`, m.ID, req.RequestedModel); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_submission_inputs(message_id,requested_model,effort) VALUES(?,?,?)`, m.ID, inputModel, inputEffort); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_submission_agents(message_id,requested_agent_id,scope,content_hash,format) VALUES(?,?,?,?,?)`, m.ID, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat); err != nil {
		return Accepted{}, err
	}
	observation := ""
	if req.RequestedAgentID != "" {
		observation = "requested_unobserved"
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_agent_selection(session_id,requested_agent_id,scope,content_hash,format,effective_agent_id,observation) VALUES(?,?,?,?,?,'',?) ON CONFLICT(session_id) DO UPDATE SET requested_agent_id=excluded.requested_agent_id,scope=excluded.scope,content_hash=excluded.content_hash,format=excluded.format,effective_agent_id=CASE WHEN workspace_chat_agent_selection.requested_agent_id<>excluded.requested_agent_id OR workspace_chat_agent_selection.scope<>excluded.scope OR workspace_chat_agent_selection.content_hash<>excluded.content_hash OR workspace_chat_agent_selection.format<>excluded.format THEN '' ELSE workspace_chat_agent_selection.effective_agent_id END,observation=CASE WHEN workspace_chat_agent_selection.requested_agent_id<>excluded.requested_agent_id OR workspace_chat_agent_selection.scope<>excluded.scope OR workspace_chat_agent_selection.content_hash<>excluded.content_hash OR workspace_chat_agent_selection.format<>excluded.format THEN excluded.observation ELSE workspace_chat_agent_selection.observation END`, id, req.RequestedAgentID, req.RequestedAgentScope, req.RequestedAgentContentHash, req.RequestedAgentFormat, observation); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_submission_efforts(message_id,effort) VALUES(?,?)`, m.ID, req.RequestedReasoningEffort); err != nil {
		return Accepted{}, err
	}
	if resolvedAgent != nil {
		if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_message_agents(message_id,agent_id,agent_name,agent_color) VALUES(?,?,?,?)`, m.ID, resolvedAgent.ID, resolvedAgent.Name, resolvedAgent.Color); err != nil {
			return Accepted{}, err
		}
		m.AgentID, m.AgentName, m.AgentColor = resolvedAgent.ID, resolvedAgent.Name, resolvedAgent.Color
	}
	if agentSwitch {
		if _, err = tx.ExecContext(ctx, `UPDATE workspace_chat_native SET thread_id='',cumulative_turn_count=NULL WHERE session_id=?`, id); err != nil {
			return Accepted{}, err
		}
		d.Session.ProviderThreadID = ""
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_efforts(session_id,requested) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET requested=excluded.requested,observed=CASE WHEN excluded.requested<>'' AND excluded.requested<>observed THEN '' ELSE observed END`, id, req.RequestedReasoningEffort); err != nil {
		return Accepted{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO workspace_chat_native(session_id,requested_model) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET requested_model=excluded.requested_model,effective_model=CASE WHEN excluded.requested_model<>'' AND excluded.requested_model<>effective_model THEN '' ELSE effective_model END`, id, req.RequestedModel); err != nil {
		return Accepted{}, err
	}
	if err = tx.Commit(); err != nil {
		return Accepted{}, err
	}
	runCtx, cancel := context.WithTimeout(context.Background(), turn.Timeout)
	s.active[id] = cancel
	s.wg.Add(1)
	d.Session.Status = "running"
	d.Session.Error = ""
	d.Session.UpdatedAt = m.CreatedAt
	d.Session.RequestedModel = req.RequestedModel
	d.Session.RequestedReasoningEffort = req.RequestedReasoningEffort
	agentChanged := req.RequestedAgentID != d.Session.RequestedAgentID || req.RequestedAgentScope != d.Session.RequestedAgentScope || req.RequestedAgentContentHash != d.Session.RequestedAgentContentHash || req.RequestedAgentFormat != d.Session.RequestedAgentFormat
	d.Session.RequestedAgentID = req.RequestedAgentID
	d.Session.RequestedAgentScope = req.RequestedAgentScope
	d.Session.RequestedAgentContentHash = req.RequestedAgentContentHash
	d.Session.RequestedAgentFormat = req.RequestedAgentFormat
	if agentChanged {
		d.Session.EffectiveAgentID = ""
		d.Session.AgentObservation = observation
	}
	if req.RequestedModel != "" && req.RequestedModel != d.Session.EffectiveModel {
		d.Session.EffectiveModel = ""
	}
	if req.RequestedReasoningEffort != "" && req.RequestedReasoningEffort != d.Session.EffectiveReasoningEffort {
		d.Session.EffectiveReasoningEffort = ""
	}
	if nativeMode {
		go s.runNative(runCtx, cancel, d.Session, m, turn)
	} else {
		go s.run(runCtx, cancel, d.Session, m, turn)
	}
	return Accepted{d.Session, m}, nil
}
func (s *Service) run(ctx context.Context, cancel context.CancelFunc, sess Session, m Message, turn agents.TurnRequest) {
	defer s.wg.Done()
	defer cancel()
	reasoning := newReasoningStream(turn.SessionID)
	result, err := s.registry.RunTurn(ctx, agents.Provider(sess.Provider), turn, func(e agents.Event) {
		for _, ne := range reasoning.events(e) {
			if err := s.recordEvent(sess.ID, ne); err != nil {
				log.Printf("workspace chat reasoning event for session %s: %v", sess.ID, err)
			}
		}
	})
	if turn.Agent != nil {
		if result.AgentObservation != "" {
			s.recordAgentReceipt(sess.ID, result.EffectiveAgentID, result.AgentObservation)
		} else {
			s.recordAgentReceipt(sess.ID, "", notApplied(err))
		}
	}
	status, msgStatus, errorText := "idle", "completed", ""
	if err != nil || result.ExitCode != 0 {
		status = "failed"
		msgStatus = "failed"
		if text := assistantText(result.Output); text != "" {
			errorText = fmt.Sprintf("Provider turn failed: %s", text)
		} else if err != nil {
			errorText = fmt.Sprintf("Provider turn failed: %v", err)
		} else {
			errorText = "Provider turn failed. Inspect CLI configuration and account readiness."
		}
	}
	if ctx.Err() != nil {
		status = "interrupted"
		msgStatus = "cancelled"
		errorText = "Turn interrupted. Workspace files were retained; inspect changes before retrying."
	}
	output := assistantText(result.Output)
	s.mu.Lock()
	defer s.mu.Unlock()
	defer delete(s.active, sess.ID)
	if err := s.finish(sess, m, output, status, msgStatus, errorText); err != nil {
		log.Printf("workspace chat finalization failed for session %s: %v", sess.ID, err)
		// Best effort recovery. If SQLite is unavailable, persisted running/stopping
		// remains blocked by Send; restarting marks those deliveries unknown.
		_, _ = s.db.Exec(`UPDATE workspace_chat_sessions SET status='interrupted',error='Chat history persistence failed; delivery outcome unknown. Inspect before sending again.' WHERE id=?`, sess.ID)
		_, _ = s.db.Exec(`UPDATE workspace_chat_messages SET status='unknown' WHERE id=?`, m.ID)
	}
}
func (s *Service) finish(sess Session, m Message, output, status, msgStatus, errorText string) error {
	tx, txErr := s.db.Begin()
	if txErr != nil {
		return txErr
	}
	defer tx.Rollback()
	if _, txErr = tx.Exec(`UPDATE workspace_chat_messages SET status=? WHERE id=?`, msgStatus, m.ID); txErr != nil {
		return txErr
	}
	if output != "" {
		replyID := uuid.NewString()
		if _, txErr = tx.Exec(`INSERT INTO workspace_chat_messages(id,session_id,role,text,status,created_at) VALUES(?,?,?,?,?,?)`, replyID, sess.ID, "assistant", output, msgStatus, stamp()); txErr != nil {
			return txErr
		}
		if _, txErr = tx.Exec(`INSERT INTO workspace_chat_message_providers(message_id,provider) VALUES(?,?)`, replyID, sess.Provider); txErr != nil {
			return txErr
		}
		// The reply was produced under the agent its user message selected.
		if _, txErr = tx.Exec(`INSERT INTO workspace_chat_message_agents(message_id,agent_id,agent_name,agent_color) SELECT ?,agent_id,agent_name,agent_color FROM workspace_chat_message_agents WHERE message_id=?`, replyID, m.ID); txErr != nil {
			return txErr
		}
	}
	if msgStatus == "completed" {
		// The new harness's native thread now holds the replayed context.
		if _, txErr = tx.Exec(`DELETE FROM workspace_chat_handoffs WHERE session_id=?`, sess.ID); txErr != nil {
			return txErr
		}
	}
	if _, txErr = tx.Exec(`UPDATE workspace_chat_sessions SET status=?,updated_at=?,error=? WHERE id=?`, status, stamp(), errorText, sess.ID); txErr != nil {
		return txErr
	}
	return tx.Commit()
}

// assistantText extracts structured assistant text and never presents raw wire JSON.
func assistantText(raw string) string {
	var text []string
	var final string
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var p map[string]any
		if json.Unmarshal([]byte(line), &p) == nil {
			if v, ok := p["result"].(string); ok {
				final = v
				continue
			}
			if params, ok := p["params"].(map[string]any); ok {
				p = params
			}
			if item, ok := p["item"].(map[string]any); ok {
				if item["type"] == "agent_message" || item["type"] == "agentMessage" {
					if v, ok := item["text"].(string); ok {
						text = append(text, v)
					}
				}
				continue
			}
			if p["type"] == "assistant" {
				if v := agents.ExtractMessage(p); v != "" {
					text = append(text, v)
				}
			}
			// OpenCode `run --format json`: {"type":"text","part":{"type":"text","text":"..."}}
			if p["type"] == "text" {
				if part, ok := p["part"].(map[string]any); ok {
					if v, ok := part["text"].(string); ok && v != "" {
						text = append(text, v)
					}
				}
			}
		} else if !strings.HasPrefix(line, "{") && !strings.HasPrefix(line, "[") {
			text = append(text, line)
		}
	}
	if final != "" {
		text = []string{final}
	}
	v := strings.Join(text, "\n\n")
	if len(v) > maxText {
		v = v[:maxText] + "\n[Output truncated]"
	}
	return v
}
func (s *Service) Stop(ctx context.Context, pid, id string) (Session, error) {
	s.mu.Lock()
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		s.mu.Unlock()
		return Session{}, err
	}
	if cancel, ok := s.active[id]; ok {
		tx, txErr := s.db.BeginTx(ctx, nil)
		if txErr != nil {
			s.mu.Unlock()
			return Session{}, txErr
		}
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO workspace_chat_lifecycle(session_id) VALUES(?)`, id); err == nil {
			err = rejectPendingRemoval(ctx, tx, pid, d.Session.WorkspaceID, d.Session.WorkspacePath)
		}
		if err == nil {
			_, err = tx.ExecContext(ctx, `UPDATE workspace_chat_sessions SET status='stopping',updated_at=? WHERE id=?`, stamp(), id)
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
		if err != nil {
			s.mu.Unlock()
			return Session{}, err
		}
		d.Session.Status = "stopping"
		if native := s.native[id]; native != nil {
			s.mu.Unlock()
			if err = native.Interrupt(ctx); err != nil {
				return Session{}, err
			}
			return d.Session, nil
		}
		cancel()
	}
	s.mu.Unlock()
	return d.Session, nil
}

// Close cancels owned turns and waits for persistence; it never removes files.
func (s *Service) Close() {
	s.mu.Lock()
	s.closed = true
	for _, cancel := range s.active {
		cancel()
	}
	natives := make([]agents.NativeSession, 0, len(s.native))
	for _, n := range s.native {
		natives = append(natives, n)
	}
	s.mu.Unlock()
	for _, n := range natives {
		closeNative(n)
	}
	s.wg.Wait()
}
