package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/db"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/mcp"
)

// MCPSource lists Orchestra-managed MCP servers (mcp_servers + config).
type MCPSource func(context.Context) ([]mcp.Server, error)

// ConfigureMCP installs the source of Orchestra MCP servers passed to runs.
func (s *Service) ConfigureMCP(source MCPSource) { s.mcpSource = source }

// runMCPServers returns enabled Orchestra servers, narrowed by the agent's
// mcp_servers list when it has one.
func (s *Service) runMCPServers(ctx context.Context, agent *agents.ResolvedAgent) ([]agents.MCPServerSpec, error) {
	if s.mcpSource == nil {
		return nil, nil
	}
	servers, err := s.mcpSource(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w: orchestra MCP servers unavailable: %v", ErrUnsupported, err)
	}
	var allow []string
	if agent != nil {
		allow = agent.MCPServers
		for _, name := range allow {
			if _, err := mcp.FindServer(servers, name); err != nil {
				return nil, fmt.Errorf("%w: agent %s requires MCP server %q, which is not configured", ErrConflict, agent.Name, name)
			}
		}
	}
	return mcp.RunSpecs(servers, allow), nil
}

// agentKey identifies the profile a native process was started with.
func agentKey(agent *agents.ResolvedAgent) string {
	if agent == nil {
		return ""
	}
	return agent.ID + "@" + agent.ContentHash
}

// notApplied renders the receipt for an agent that could not be applied.
func notApplied(err error) string {
	reason := "unknown"
	if err != nil {
		reason = strings.ReplaceAll(err.Error(), "\n", " ")
		if len(reason) > 200 {
			reason = reason[:200]
		}
	}
	return agents.AgentNotApplied + ":" + reason
}

// recordAgentReceipt stores the applied receipt on the session.
func (s *Service) recordAgentReceipt(sessionID, effectiveID, observation string) {
	if observation == "" {
		return
	}
	_, _ = s.db.Exec(`UPDATE workspace_chat_agent_selection SET effective_agent_id=?,observation=? WHERE session_id=?`, effectiveID, observation, sessionID)
}

func (s *Service) persistedThread(ctx context.Context, sessionID string) (string, error) {
	var thread string
	err := s.db.QueryRowContext(ctx, `SELECT thread_id FROM workspace_chat_native WHERE session_id=?`, sessionID).Scan(&thread)
	return thread, err
}

func migrateAgentProfiles(d *db.DB) error {
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_message_agents(message_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL DEFAULT '', agent_name TEXT NOT NULL DEFAULT '', agent_color TEXT NOT NULL DEFAULT '');
	 CREATE TABLE IF NOT EXISTS workspace_chat_native_agents(session_id TEXT PRIMARY KEY, agent_key TEXT NOT NULL DEFAULT '');`)
	return err
}

// threadAgentKey is the agent profile the current provider thread was started with.
func (s *Service) threadAgentKey(ctx context.Context, sessionID string) (string, error) {
	var key string
	err := s.db.QueryRowContext(ctx, `SELECT agent_key FROM workspace_chat_native_agents WHERE session_id=?`, sessionID).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return key, err
}

func (s *Service) saveThreadAgentKey(sessionID, key string) error {
	_, err := s.db.Exec(`INSERT INTO workspace_chat_native_agents(session_id,agent_key) VALUES(?,?) ON CONFLICT(session_id) DO UPDATE SET agent_key=excluded.agent_key`, sessionID, key)
	return err
}

// agentHandoffTranscript seeds a fresh native thread after an agent switch.
func agentHandoffTranscript(messages []Message, agent *agents.ResolvedAgent, prompt string, budget int) string {
	name := "the harness default agent"
	if agent != nil {
		name = "the " + agent.Name + " agent"
	}
	header := fmt.Sprintf("The user switched this conversation to %s. Your native session starts here; the earlier Orchestra conversation follows as context. Work only in the selected project.\n", name)
	return replayTranscript(header, messages, prompt, budget)
}
