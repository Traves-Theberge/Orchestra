# Configuration

Configuration schema and load pipeline for backend startup.

## Files
- `types.go`: Defines the `Config` struct and helper methods used across packages.
- `load.go`: Loads env/frontmatter config, applies defaults, validates values, and parses structured fields.
- `load_test.go`: Covers config precedence, parsing edge cases, and fallback behavior.
