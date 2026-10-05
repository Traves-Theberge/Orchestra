package harnesssetup

import (
	"context"
	"errors"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Observation string

const (
	Detected  Observation = "detected"
	Missing   Observation = "missing"
	Unknown   Observation = "unknown"
	SignedIn  Observation = "signed_in"
	SignedOut Observation = "signed_out"
)

type Harness struct {
	ID                string      `json:"id"`
	Registered        bool        `json:"registered"`
	CommandConfigured bool        `json:"command_configured"`
	Installation      Observation `json:"installation"`
	Authentication    Observation `json:"authentication"`
	Executable        string      `json:"executable,omitempty"`
	TerminalSupported bool        `json:"terminal_supported"`
}

type definition struct {
	id, executable string
}

var known = []definition{
	{"CODEX", "codex"}, {"CLAUDE", "claude"},
	{"OPENCODE", "opencode"},
	{"ANTIGRAVITY", "agy"}, {"8GENT", "8gent"},
}

type Lookup func(string) (string, error)
type AuthProbe func(context.Context, string) (Observation, error)

// Observe uses only known executable names. It never executes a configured
// command template, which can contain arbitrary user-supplied shell syntax.
func Observe(ctx context.Context, registered []string, commands map[string]string, lookup Lookup, auth AuthProbe) []Harness {
	registeredSet := make(map[string]bool, len(registered))
	for _, id := range registered {
		registeredSet[strings.ToUpper(strings.TrimSpace(id))] = true
	}
	commandSet := make(map[string]bool, len(commands))
	for id, command := range commands {
		commandSet[strings.ToUpper(strings.TrimSpace(id))] = strings.TrimSpace(command) != ""
	}
	result := make([]Harness, 0, len(known))
	for _, item := range known {
		row := Harness{ID: item.id, Registered: registeredSet[item.id], CommandConfigured: commandSet[item.id], Installation: Missing, Authentication: Unknown}
		lookupName := item.executable
		knownBinary := true
		if configured := configuredExecutable(commands, item.id); configured != "" {
			lookupName = configured
			knownBinary = false
		}
		path, err := lookup(lookupName)
		if err == nil && path != "" {
			row.Installation = Detected
			row.Executable = path
			if item.id == "CODEX" && knownBinary && auth != nil {
				state, probeErr := auth(ctx, path)
				if probeErr == nil {
					row.Authentication = state
				}
			}
		}
		result = append(result, row)
	}
	return result
}

// Only an absolute leading executable path is interpreted from a command
// template. The rest is never parsed or run. Relative shell expressions stay
// outside this observation and use the known provider executable on PATH.
func configuredExecutable(commands map[string]string, id string) string {
	for key, command := range commands {
		if !strings.EqualFold(strings.TrimSpace(key), id) {
			continue
		}
		command = strings.TrimSpace(command)
		if command == "" {
			return ""
		}
		var candidate string
		if command[0] == '"' || command[0] == '\'' {
			if end := strings.IndexByte(command[1:], command[0]); end >= 0 {
				candidate = command[1 : end+1]
			}
		} else {
			candidate, _, _ = strings.Cut(command, " ")
		}
		if filepath.IsAbs(candidate) {
			return candidate
		}
		return ""
	}
	return ""
}

// ProbeCodexAuth asks the provider's read-only status command. An exit code of
// one alone is ambiguous: Codex uses it for both signed-out and probe errors.
// Output is inspected only for the exact signed-out message and never returned.
func ProbeCodexAuth(ctx context.Context, path string) (Observation, error) {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	command := exec.CommandContext(bounded, path, "login", "status")
	var stderr limitedOutput
	command.Stdout, command.Stderr = io.Discard, &stderr
	err := command.Run()
	if err == nil {
		return SignedIn, nil
	}
	if bounded.Err() != nil {
		return Unknown, bounded.Err()
	}
	return classifyCodexStatus(err, string(stderr.data))
}

func classifyCodexStatus(err error, stderr string) (Observation, error) {
	if err == nil {
		return SignedIn, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 && strings.TrimSpace(stderr) == "Not logged in" {
		return SignedOut, nil
	}
	return Unknown, err
}

type limitedOutput struct{ data []byte }

func (output *limitedOutput) Write(p []byte) (int, error) {
	const limit = 4096
	if remaining := limit - len(output.data); remaining > 0 {
		output.data = append(output.data, p[:min(len(p), remaining)]...)
	}
	return len(p), nil
}
