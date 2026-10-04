package studio

import (
	"os"
	"path/filepath"
)

// SocketPath returns the absolute path to the unix socket used by mcp-bridge
// subprocesses to connect back to the running daemon. The path must be absolute
// so that the mcp-bridge subprocess (which runs in an isolated worktree
// directory) resolves it correctly regardless of its working directory.
func SocketPath(workspaceRoot string) string {
	if workspaceRoot == "" {
		workspaceRoot = os.TempDir()
	}
	p := filepath.Join(workspaceRoot, ".orchestra", "studio.sock")
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}
