# Backend Service Index

This directory contains the Orchestra backend daemon, CLI entrypoints, and all internal packages.

## Files
- `go.mod`: Go module manifest and dependency declarations.
- `go.sum`: Dependency checksum lockfile used for reproducible module verification.
- `LICENSE`: Apache 2.0 license text for backend distribution terms.
- `orchestrad`: Compiled backend daemon binary (ELF executable).
- `orchestrad_new`: Alternate compiled backend daemon binary.
- `orchestrad.log`: Local runtime log artifact for daemon output.

## Subdirectories
- `cmd/`: Executable entrypoints (`orchestra`, `orchestrad`).
- `internal/`: Core backend implementation packages.
- `scripts/`: SQL and operational helper scripts.
