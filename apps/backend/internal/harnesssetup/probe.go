package harnesssetup

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
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
	ID                  string      `json:"id"`
	Registered          bool        `json:"registered"`
	RegistrationVersion int64       `json:"registration_version"`
	CommandConfigured   bool        `json:"command_configured"`
	Installation        Observation `json:"installation"`
	Authentication      Observation `json:"authentication"`
	Executable          string      `json:"executable,omitempty"`
	TerminalSupported   bool        `json:"terminal_supported"`
	CredentialEntries   *int        `json:"credential_entries,omitempty"`
	// Version is the CLI's self-reported version where probing is cheap and safe.
	Version string `json:"version,omitempty"`
}

type definition struct {
	id, executable string
}

var known = []definition{
	{"CODEX", "codex"}, {"CLAUDE", "claude"},
	{"OPENCODE", "opencode"},
	{"ANTIGRAVITY", "agy"}, {"OMP", "omp"}, {"8GENT", "8gent"},
}

type Lookup func(string) (string, error)
type AuthProbe func(context.Context, string, string) (Observation, error)

func ProbeSupportedAuth(ctx context.Context, id string, path string) (Observation, error) {
	switch id {
	case "CODEX":
		return ProbeCodexAuth(ctx, path)
	case "CLAUDE":
		return ProbeClaudeAuth(ctx, path)
	default:
		return Unknown, nil
	}
}

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
			if (item.id == "CODEX" || item.id == "CLAUDE") && knownBinary && auth != nil {
				state, probeErr := auth(ctx, item.id, path)
				if probeErr == nil {
					row.Authentication = state
				}
			}
			if item.id == "OMP" && knownBinary {
				row.Version = ProbeOMPVersion(ctx, path)
			}
			if item.id == "OPENCODE" && knownBinary {
				if count, probeErr := ProbeOpenCodeCredentialCatalog(ctx, path); probeErr == nil {
					row.CredentialEntries = &count
				}
			}
		}
		result = append(result, row)
	}
	return result
}

// ProbeOpenCodeCredentialCatalog counts saved provider entries without returning
// credentials. A listed entry is configuration evidence, not verified access.
func ProbeOpenCodeCredentialCatalog(ctx context.Context, path string) (int, error) {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	command := backgroundcommand.CommandContext(bounded, path, "auth", "list", "--format", "json")
	var output limitedOutput
	command.Stdout, command.Stderr = &output, io.Discard
	if err := command.Run(); err != nil {
		return 0, err
	}
	if bounded.Err() != nil {
		return 0, bounded.Err()
	}
	return classifyOpenCodeCredentialCatalog(output.data)
}

func classifyOpenCodeCredentialCatalog(data []byte) (int, error) {
	var entries []json.RawMessage
	if err := json.Unmarshal(data, &entries); err != nil {
		return 0, err
	}
	if entries == nil {
		return 0, errors.New("OpenCode credential catalog is not an array")
	}
	return len(entries), nil
}

// ProbeClaudeAuth reads the JSON status supported by Claude Code. A failed or
// malformed command remains unknown; only an explicit logged-out JSON result
// with the documented exit status becomes signed_out.
func ProbeClaudeAuth(ctx context.Context, path string) (Observation, error) {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	command := backgroundcommand.CommandContext(bounded, path, "auth", "status")
	var stdout limitedOutput
	command.Stdout, command.Stderr = &stdout, io.Discard
	err := command.Run()
	if bounded.Err() != nil {
		return Unknown, bounded.Err()
	}
	return classifyClaudeStatus(err, stdout.data)
}

func classifyClaudeStatus(err error, output []byte) (Observation, error) {
	var status struct {
		LoggedIn   *bool  `json:"loggedIn"`
		AuthMethod string `json:"authMethod"`
	}
	if parseErr := json.Unmarshal(output, &status); parseErr != nil || status.LoggedIn == nil {
		return Unknown, errors.New("unrecognized Claude auth status")
	}
	if err == nil && *status.LoggedIn && status.AuthMethod != "" && status.AuthMethod != "none" {
		return SignedIn, nil
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) && exit.ExitCode() == 1 && !*status.LoggedIn && status.AuthMethod == "none" {
		return SignedOut, nil
	}
	return Unknown, errors.New("inconsistent Claude auth status")
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
	return ProbeCodexAuthInHome(ctx, path, "")
}

func ProbeCodexAuthInHome(ctx context.Context, path, home string) (Observation, error) {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	command := backgroundcommand.CommandContext(bounded, path, "login", "status")
	if home != "" {
		command.Env = harnessaccounts.CodexProcessEnv(home)
	}
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

// ProbeOMPVersion reads `omp --version` ("omp/18.7.0"). It reads no
// credentials; an empty result means the version was not observed.
func ProbeOMPVersion(ctx context.Context, path string) string {
	bounded, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	command := backgroundcommand.CommandContext(bounded, path, "--version")
	var output limitedOutput
	command.Stdout, command.Stderr = &output, io.Discard
	if err := command.Run(); err != nil {
		return ""
	}
	version := strings.TrimSpace(string(output.data))
	version = strings.TrimPrefix(version, "omp/")
	if version == "" || len(version) > 64 || strings.ContainsAny(version, " \n") {
		return ""
	}
	return version
}
