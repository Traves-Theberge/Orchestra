# Configuration Architecture

The Orchestra platform relies on a multi-layered configuration system designed for maximum flexibility, allowing seamless transitions between local development, project-specific tuning, and global fleet management.

## 🏗️ Configuration Layers (Resolution Order)

Configuration is resolved in the following priority (highest to lowest):

1. **Environment Variables**: Explicit runtime arguments (e.g., `ORCHESTRA_AGENT_PROVIDER=claude`).
2. **Workflow Overrides (`WORKFLOW.md`)**: A project-specific Markdown file that contains a YAML front-matter block. This allows configuration to be committed directly into a target repository alongside its source code.
3. **Global Workspace Defaults (`workspace.json`)**: System-wide defaults stored in the orchestrator's root (`~/.orchestra/workspaces/.orchestra/agents/workspace.json`).
4. **Hardcoded Defaults**: Fallback values defined directly in the Go backend (e.g., fallback ports or default provider).

## 📄 Core Types (`internal/config/types.go`)

The resolved configuration is mapped into a strongly-typed `Config` struct that is passed down to all major subsystems:

```go
type Config struct {
	Host                     string
	Port                     int
	WorkspaceRoot            string
	APIToken                 string
	AgentProvider            string
	AgentCommands            map[string]string
	AgentMaxTurns            int
	LinearEndpoint          string
	LinearToken             string
	LinearProject           string
	LinearWorkerAssigneeIDs []string
	ActiveStates             []string
	TerminalStates           []string
	MaxConcurrent            int
	MaxConcurrentByState     map[string]int
	WorkspaceHooks           workspace.Hooks
	ProjectRoots             []string
	GitHubClientID           string
	GitHubClientSecret       string
}
```

## ⚙️ The Loader (`internal/config/load.go`)

The `Load()` function acts as the central initialization phase before the orchestrator boots. 

### Key Behaviors:
- **Fallback Chains**: If an environment variable is missing, it falls back to the `workflowOverrides` (parsed from `WORKFLOW.md`), and finally to default constants.
- **Port Validation**: Ensures the provided port is a valid integer between 1 and 65535.
- **State Normalization**: Parses comma-separated lists of states (e.g., `Todo,In Progress`) into strongly typed arrays.
- **Concurrency Maps**: Parses complex key-value concurrency limits (e.g., `Running:5,Review:2`) into the `MaxConcurrentByState` map.

### Agent Command Defaults
If no commands are provided, the loader initializes the `AgentCommands` map with tested defaults for supported CLIs:
- `codex`: `codex exec --skip-git-repo-check --json {{prompt}}`
- `claude`: `claude -p {{prompt}} --output-format json`
- `opencode`: `opencode run {{prompt}} --format json`
- `gemini`: `gemini --output-format stream-json {{prompt}}`

## 🔒 Security Posture
The configuration loader enforces basic security constraints. Most notably, if the `Host` is set to a non-loopback address (e.g., `0.0.0.0`), the system **will refuse to start** unless a valid `ORCHESTRA_API_TOKEN` is provided, preventing accidental exposure of the control plane to the open internet.
