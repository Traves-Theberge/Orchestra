---
server:
  host: 0.0.0.0
  port: 4010
  api_token: ""
workspace:
  root: /tmp/orchestra
  project_roots:
    - /home/traves/Development
    - /tmp/orchestra
github:
  client_id: YOUR_GITHUB_CLIENT_ID_HERE
  client_secret: YOUR_GITHUB_CLIENT_SECRET_HERE
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

Before implementation, write an "Operational Plan" that mirrors the task list from the issue description using markdown checkboxes.
Use this exact checklist style so the UI can parse it:
- [ ] analyze
- [ ] implement
- [ ] verify
Update checklist items to `- [x]` as work is completed.
