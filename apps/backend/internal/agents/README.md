# Agent Runners

Provider-specific and generic execution runners for agent turns.

## Files
- `types.go`: Shared agent request/event/result types and runner interfaces.
- `registry.go`: Provider-to-runner registry and dispatch entrypoint.
- `registry_test.go`: Ensures provider normalization and runner selection behavior.
- `config.go`: Agent config discovery/load/update for global and project scopes.
- `command_runner.go`: Generic command-based runner with event parsing and token accounting.
- `command_runner_test.go`: Extensive parser, timeout, cancellation, and usage aggregation tests.
- `codex_appserver.go`: Codex app-server JSON-RPC runner with turn loop and approval handling.
- `codex_appserver_test.go`: Protocol-level tests for Codex app-server execution paths.
- `claude_runner.go`: Claude provider wrapper around command runner defaults.
- `gemini_runner.go`: Gemini provider wrapper with stream-JSON command defaults.
- `opencode_runner.go`: OpenCode provider wrapper around command runner defaults.
