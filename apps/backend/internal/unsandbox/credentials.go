package unsandbox

import (
	"encoding/base64"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

// SyncClaudeCredentials reads local Claude credentials and returns shell
// commands to inject them into a container with secure permissions.
// Returns empty string if credentials are not found (non-fatal).
func SyncClaudeCredentials() string {
	u, err := user.Current()
	if err != nil {
		return ""
	}

	credFile := filepath.Join(u.HomeDir, ".claude", ".credentials.json")
	data, err := os.ReadFile(credFile)
	if err != nil {
		return ""
	}

	b64 := base64.StdEncoding.EncodeToString(data)
	lines := []string{
		"umask 077 && mkdir -p ~/.claude",
		"chmod 700 ~/.claude",
		fmt.Sprintf("printf '%%s' %s | base64 -d > ~/.claude/.credentials.json", shellQuote(b64)),
		"chmod 600 ~/.claude/.credentials.json",
	}

	// Settings files (non-fatal)
	for _, name := range []string{"settings.json", "settings.local.json"} {
		settingsPath := filepath.Join(u.HomeDir, ".claude", name)
		sData, err := os.ReadFile(settingsPath)
		if err != nil {
			continue
		}
		sB64 := base64.StdEncoding.EncodeToString(sData)
		lines = append(lines, fmt.Sprintf("printf '%%s' %s | base64 -d > ~/.claude/%s", shellQuote(sB64), shellQuote(name)))
	}

	return strings.Join(lines, "\n")
}

// shellQuote wraps a value in single quotes, escaping embedded single quotes.
func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}
