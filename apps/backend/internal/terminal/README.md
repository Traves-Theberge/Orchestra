# Terminal Sessions

PTY-backed terminal lifecycle used by websocket terminal endpoints.

## Files
- `manager.go`: Creates/reuses terminal sessions, streams output, handles resize/input, and cleans session handlers.
