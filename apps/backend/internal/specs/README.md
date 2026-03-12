# Spec Validation

Runtime and PR-body conformance checks.

## Files
- `check.go`: Validates that required runtime/provider spec prerequisites are satisfied.
- `check_test.go`: Tests positive/negative validation cases.
- `pr_body.go`: Lints PR body markdown against repository template expectations.
- `pr_body_test.go`: Verifies PR-body lint rules and helper behavior.
