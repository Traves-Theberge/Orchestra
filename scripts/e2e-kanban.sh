#!/usr/bin/env bash
# scripts/e2e-kanban.sh — repro helper for the #147 agent E2E matrix.
#
# Walks one issue through the Kanban lifecycle for a chosen provider against a
# running orchestrad. Designed to make each row of docs/testing/agent-e2e-status.md
# take minutes instead of hours.
#
# Usage:
#   ORCHESTRA_API_TOKEN=... scripts/e2e-kanban.sh setup
#   ORCHESTRA_API_TOKEN=... scripts/e2e-kanban.sh run <provider> <project_id> [title]
#   ORCHESTRA_API_TOKEN=... scripts/e2e-kanban.sh tail <issue_identifier>
#
# Env:
#   ORCHESTRA_HOST          default 127.0.0.1:3284
#   ORCHESTRA_API_TOKEN     required for non-loopback; default "dev-token"
#   ORCHESTRA_WORKSPACE_ROOT used to print the expected worktree path

set -euo pipefail

HOST="${ORCHESTRA_HOST:-127.0.0.1:3284}"
TOKEN="${ORCHESTRA_API_TOKEN:-dev-token}"
WORKSPACE_ROOT="${ORCHESTRA_WORKSPACE_ROOT:-${HOME}/orchestra}"
BASE="http://${HOST}/api/v1"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
dim()    { printf "\033[2m%s\033[0m\n" "$*"; }

require_tool() {
  command -v "$1" >/dev/null 2>&1 || { red "missing required tool: $1"; exit 2; }
}
require_tool curl
require_tool jq

curl_json() {
  curl --silent --show-error --fail-with-body \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

cmd_setup() {
  yellow "==> backend health"
  if ! curl_json "${BASE}/healthz" | jq .; then
    red "backend not reachable at ${BASE}; start orchestrad first"
    exit 1
  fi

  yellow "==> registered projects"
  local projects
  projects=$(curl_json "${BASE}/projects")
  echo "${projects}" \
    | jq -r '(if type=="array" then . else (.projects // []) end)
             | .[] | "  \(.id)  \(.name)  (\(.root_path))  tracker=\(.tracker_config_id // "<none>")"'

  yellow "==> agent providers"
  curl_json "${BASE}/agents" \
    | jq -r '.agents // [] | .[] | "  \(.)"' \
    || dim "  (no providers configured)"

  green "setup ok — pick a provider and project_id and run: scripts/e2e-kanban.sh run <provider> <project_id>"
}

cmd_run() {
  local provider="${1:-}"
  local project_id="${2:-}"
  local title="${3:-E2E smoke (${provider}) $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

  if [[ -z "${provider}" || -z "${project_id}" ]]; then
    red "usage: $0 run <provider> <project_id> [title]"
    red "       provider in: claude | codex | opencode | gemini"
    exit 2
  fi

  yellow "==> creating issue (provider=${provider} project=${project_id})"
  local issue
  issue=$(curl_json -X POST "${BASE}/issues" -d "$(jq -n \
    --arg t "${title}" \
    --arg d "Smoke test for #147 — ${provider} end-to-end. Touch a single file and stop." \
    --arg s "Todo" \
    --arg p "${project_id}" \
    --arg pr "${provider}" \
    '{title:$t, description:$d, state:$s, priority:2, project_id:$p, provider:$pr}')")
  echo "${issue}" | jq .

  local identifier
  identifier=$(echo "${issue}" | jq -r '.identifier // .Identifier')
  if [[ -z "${identifier}" || "${identifier}" == "null" ]]; then
    red "could not read identifier from POST /issues response"
    exit 1
  fi

  green "issue created: ${identifier}"
  dim   "expected worktree dir under: ${WORKSPACE_ROOT}/<branch>/"
  dim   "session log lives at:        ${WORKSPACE_ROOT}/<wt>/_logs/${identifier}/latest.log"
  dim   "Kanban link (UI):            http://localhost:5173 (open and find ${identifier})"

  yellow "==> tailing SSE — Ctrl-C to stop, then walk the card through Review/Done"
  cmd_tail "${identifier}"
}

cmd_tail() {
  local identifier="${1:-}"
  if [[ -z "${identifier}" ]]; then
    red "usage: $0 tail <issue_identifier>"
    exit 2
  fi

  # The /api/v1/events SSE stream is global; filter by identifier client-side.
  curl --silent --no-buffer \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: text/event-stream" \
    "${BASE}/events" \
    | awk -v id="${identifier}" '
        /^data: / {
          line=substr($0, 7)
          if (index(line, id) > 0) print line
          fflush()
        }
      '
}

main() {
  local sub="${1:-}"
  shift || true
  case "${sub}" in
    setup) cmd_setup "$@" ;;
    run)   cmd_run "$@" ;;
    tail)  cmd_tail "$@" ;;
    *)
      cat <<EOF
usage: $0 setup
       $0 run <provider> <project_id> [title]
       $0 tail <issue_identifier>

env:
  ORCHESTRA_HOST            default 127.0.0.1:3284
  ORCHESTRA_API_TOKEN       default dev-token
  ORCHESTRA_WORKSPACE_ROOT  default \$HOME/orchestra

providers: claude | codex | opencode | gemini
EOF
      exit 2
      ;;
  esac
}

main "$@"
