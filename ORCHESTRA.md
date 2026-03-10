---
server:
  host: 0.0.0.0
  port: 4010
  api_token: dev-token
workspace:
  root: /tmp/orchestra
agent:
  provider: gemini
  skills:
    - grep_search
    - cli_help
    - list_directory
    - read_file
    - write_file
    - run_shell_command
---
Standard Orchestra agent session initialized. Use available tools to fulfill requests.
