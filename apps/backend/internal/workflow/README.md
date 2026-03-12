# Workflow Store

Workflow markdown frontmatter parsing and in-memory document storage.

## Files
- `frontmatter.go`: Parses workflow frontmatter config and prompt body content.
- `frontmatter_test.go`: Tests valid/invalid/no-frontmatter parsing scenarios.
- `store.go`: Thread-safe workflow document store with reload and path switching.
- `store_test.go`: Validates store reload semantics and path updates.
