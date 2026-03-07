package config

import (
	"strconv"

	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

type Config struct {
	Host                     string
	Port                     int
	WorkspaceRoot            string
	APIToken                 string
	WorkflowFile             string
	AgentProvider            string
	AgentCommands            map[string]string
	AgentMaxTurns            int
	TrackerEndpoint          string
	TrackerToken             string
	TrackerProject           string
	TrackerWorkerAssigneeIDs []string
	ActiveStates             []string
	TerminalStates           []string
	MaxConcurrent            int
	MaxConcurrentByState     map[string]int
	WorkspaceHooks           workspace.Hooks
}

func (c Config) PortString() string {
	return strconv.Itoa(c.Port)
}
