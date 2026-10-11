#!/usr/bin/env bash

set -euo pipefail

MODE="${1:---staged}"

ORCHESTRA_PATTERNS=(
  "orchestrd"
  "orchestra-dash"
  "apps/backend/orchestrd"
  "apps/tui/orchestra"
  "orchestrd-*"
  "orchestra-*"
)

BINARY_PATTERNS=(
  "*.exe"
  "*.bin"
  "*.dll"
  "*.so"
  "*.dylib"
  "*.a"
  "*.o"
  "*.out"
  "*.db"
  "*.sqlite"
  "*.sqlite3"
  "warehouse.db*"
)

SENSITIVE_PATTERNS=(
  ".env*"
  "*.key"
  "*.pem"
  "*.p12"
  "*.pfx"
  "*secret*"
  "*credential*"
  "*password*"
  "*token*"
)

TEXT_PATTERNS=(
  "*.md"
  "*.txt"
  "*.json"
  "*.yml"
  "*.yaml"
  "*.sh"
  "*.bash"
  "*.zsh"
  "*.go"
  "*.js"
  "*.cjs"
  "*.mjs"
  "*.ts"
  "*.mts"
  "*.cts"
  "*.tsx"
  "*.jsx"
  "*.css"
  "*.html"
  "*.xml"
  "*.toml"
  "*.ini"
  "*.conf"
  "*.cfg"
  "*.sql"
  "*.proto"
  "*.graphql"
  "*.gql"
  "*.svg"
  ".gitignore"
  ".gitattributes"
  "Makefile"
  "Dockerfile"
)

ALLOWED_BINARY_PATHS=(
  "apps/desktop/public/*.png"
  "apps/desktop/public/*.jpg"
  "apps/desktop/public/*.jpeg"
  "apps/desktop/public/*.gif"
  "apps/desktop/public/*.svg"
  "apps/desktop/public/*.ico"
  "docs/*.png"
  "docs/*.jpg"
  "docs/*.jpeg"
  "docs/*.gif"
  "docs/*.svg"
  "assets/*.png"
  "assets/*.jpg"
  "assets/*.jpeg"
  "assets/*.gif"
  "assets/*.svg"
)

is_match() {
  local path="$1"
  shift
  local pattern
  for pattern in "$@"; do
    case "$path" in
      $pattern) return 0 ;;
    esac
  done
  return 1
}

is_text_file() {
  local path="$1"
  is_match "$path" "${TEXT_PATTERNS[@]}"
}

is_allowed_binary_path() {
  local path="$1"
  # Electron needs this tracked icon. Match its exact path and PNG MIME so the
  # asset exception cannot admit executables or arbitrary binaries beside it.
  if [[ "$path" == "apps/desktop/electron/assets/icon.png" ]]; then
    [[ "$(file --brief --mime-type "$path" 2>/dev/null || true)" == "image/png" ]]
    return
  fi
  is_match "$path" "${ALLOWED_BINARY_PATHS[@]}"
}

is_binary_mime() {
  local path="$1"
  local mime
  mime="$(file --brief --mime "$path" 2>/dev/null || true)"
  [[ "$mime" == *"charset=binary"* ]]
}

is_executable_binary() {
  local path="$1"
  [[ -x "$path" ]] && file "$path" 2>/dev/null | grep -Eq "ELF|Mach-O|PE32"
}

list_staged_files() {
  git diff --cached --name-only --diff-filter=ACMR
}

list_repo_files() {
  git ls-files | sort
}

print_intro() {
  echo "🔍 Orchestra Binary Protection: Scanning files..."
}

check_files() {
  local files=("$@")
  local blocked=()
  local file

  for file in "${files[@]}"; do
    [[ -z "$file" ]] && continue
    [[ ! -f "$file" ]] && continue

    if is_text_file "$file"; then
      continue
    fi

    if is_allowed_binary_path "$file"; then
      continue
    fi

    if is_match "$file" "${ORCHESTRA_PATTERNS[@]}"; then
      blocked+=("$file (Orchestra binary - NEVER commit these!)")
      continue
    fi

    if is_match "$file" "${BINARY_PATTERNS[@]}"; then
      blocked+=("$file (Binary file)")
      continue
    fi

    if is_match "$file" "${SENSITIVE_PATTERNS[@]}"; then
      blocked+=("$file (Sensitive file)")
      continue
    fi

    if is_binary_mime "$file"; then
      blocked+=("$file (Detected as binary)")
      continue
    fi

    if is_executable_binary "$file"; then
      blocked+=("$file (Executable binary)")
      continue
    fi
  done

  if ((${#blocked[@]} > 0)); then
    echo ""
    echo "🚫 =============================================="
    echo "🚫 COMMIT BLOCKED - BINARY FILES DETECTED!"
    echo "🚫 =============================================="
    echo ""
    echo "The following files are blocked from being committed:"
    echo ""
    for file in "${blocked[@]}"; do
      echo "  ❌ $file"
    done
    echo ""
    echo "🔧 TO FIX THIS:"
    echo "1. Remove these files from staging:"
    echo "   git reset HEAD <filename>"
    echo ""
    echo "2. Add them to .gitignore if they should never be tracked:"
    echo "   echo '<filename>' >> .gitignore"
    echo ""
    echo "3. For Orchestra binaries, rebuild when needed:"
    echo "   cd apps/backend && go build -o orchestrad ./cmd/orchestrad"
    echo "   cd apps/tui && go build -o orchestra-dash ."
    echo ""
    echo "🛡️  This protection prevents repository bloat and security issues."
    echo "🚫 =============================================="
    echo ""
    return 1
  fi

  echo "✅ All scanned files passed binary protection check!"
  return 0
}

main() {
  print_intro

  local files=()
  case "$MODE" in
    --staged)
      mapfile -t files < <(list_staged_files)
      if ((${#files[@]} == 0)); then
        echo "✅ No staged files to check."
        exit 0
      fi
      echo "📋 Checking ${#files[@]} staged files..."
      ;;
    --repo)
      mapfile -t files < <(list_repo_files)
      echo "📋 Checking ${#files[@]} repository files..."
      ;;
    *)
      echo "usage: $0 [--staged|--repo]" >&2
      exit 2
      ;;
  esac

  check_files "${files[@]}"
}

main "$@"
