# orchestra CLI

This package provides the primary backend CLI command.

## Files
- `main.go`: Parses subcommands (`start`, `check`, `check-pr-body`) and dispatches to app/spec routines.
- `main_test.go`: Validates argument handling, error paths, and expected command outputs.
