package main

import (
	"fmt"
	"io"
	"os"

	"github.com/orchestra/orchestra/apps/backend/internal/app"
	"github.com/orchestra/orchestra/apps/backend/internal/logging"
	"github.com/orchestra/orchestra/apps/backend/internal/specs"
)

type cliRunner struct {
	start       func() error
	check       func() error
	checkPRBody func(path string) error
}

func runCLI(args []string, stdout io.Writer, stderr io.Writer, runner cliRunner) int {
	if len(args) < 2 {
		fmt.Fprintln(stderr, "usage: orchestra <start|check|check-pr-body>")
		return 2
	}

	switch args[1] {
	case "start":
		if err := runner.start(); err != nil {
			fmt.Fprintf(stderr, "orchestra start failed: %v\n", err)
			return 1
		}
		return 0
	case "check":
		if err := runner.check(); err != nil {
			fmt.Fprintf(stderr, "orchestra check failed: %v\n", err)
			return 1
		}
		fmt.Fprintln(stdout, "orchestra check: ok")
		return 0
	case "check-pr-body":
		if len(args) < 3 {
			fmt.Fprintln(stderr, "usage: orchestra check-pr-body /path/to/pr_body.md")
			return 2
		}
		if err := runner.checkPRBody(args[2]); err != nil {
			fmt.Fprintf(stderr, "orchestra check-pr-body failed: %v\n", err)
			return 1
		}
		fmt.Fprintln(stdout, "orchestra check-pr-body: ok")
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command: %s\n", args[1])
		return 2
	}
}

func main() {
	logger := logging.New()
	exitCode := runCLI(os.Args, os.Stdout, os.Stderr, cliRunner{
		start: func() error {
			return app.Run(logger)
		},
		check: func() error {
			return specs.Check()
		},
		checkPRBody: func(path string) error {
			return specs.CheckPRBody(path)
		},
	})
	if exitCode != 0 {
		os.Exit(exitCode)
	}
}
