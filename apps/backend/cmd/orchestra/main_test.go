package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func TestRunCLIRequiresCommand(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	code := runCLI([]string{"orchestra"}, stdout, stderr, cliRunner{})
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d", code)
	}
	if !strings.Contains(stderr.String(), "usage: orchestra") {
		t.Fatalf("expected usage message, got %q", stderr.String())
	}
}

func TestRunCLIUnknownCommand(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	code := runCLI([]string{"orchestra", "wat"}, stdout, stderr, cliRunner{})
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d", code)
	}
	if !strings.Contains(stderr.String(), "unknown command: wat") {
		t.Fatalf("expected unknown command message, got %q", stderr.String())
	}
}

func TestRunCLICheckSuccess(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	code := runCLI([]string{"orchestra", "check"}, stdout, stderr, cliRunner{check: func() error { return nil }})
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if !strings.Contains(stdout.String(), "orchestra check: ok") {
		t.Fatalf("expected check success output, got %q", stdout.String())
	}
}

func TestRunCLICheckFailure(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	code := runCLI([]string{"orchestra", "check"}, stdout, stderr, cliRunner{check: func() error { return errors.New("boom") }})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
	if !strings.Contains(stderr.String(), "orchestra check failed") {
		t.Fatalf("expected check failure output, got %q", stderr.String())
	}
}

func TestRunCLICheckPRBodyRequiresPath(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	code := runCLI([]string{"orchestra", "check-pr-body"}, stdout, stderr, cliRunner{})
	if code != 2 {
		t.Fatalf("expected exit code 2, got %d", code)
	}
	if !strings.Contains(stderr.String(), "usage: orchestra check-pr-body") {
		t.Fatalf("expected usage message, got %q", stderr.String())
	}
}

func TestRunCLICheckPRBodySuccess(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}

	gotPath := ""
	code := runCLI(
		[]string{"orchestra", "check-pr-body", "/tmp/body.md"},
		stdout,
		stderr,
		cliRunner{checkPRBody: func(path string) error {
			gotPath = path
			return nil
		}},
	)
	if code != 0 {
		t.Fatalf("expected exit code 0, got %d", code)
	}
	if gotPath != "/tmp/body.md" {
		t.Fatalf("expected check-pr-body path to pass through, got %q", gotPath)
	}
	if !strings.Contains(stdout.String(), "orchestra check-pr-body: ok") {
		t.Fatalf("expected check-pr-body success output, got %q", stdout.String())
	}
}
