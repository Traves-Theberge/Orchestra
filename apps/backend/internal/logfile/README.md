# Logfile Persistence

Issue/session log writing helpers.

## Files
- `logfile.go`: Appends session log output and maintains `latest.log` symlink conventions.
- `logfile_test.go`: Validates write behavior, symlink updates, and identifier sanitization.
