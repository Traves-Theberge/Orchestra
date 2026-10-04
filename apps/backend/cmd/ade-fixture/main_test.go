package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/ade"
	"github.com/orchestra/orchestra/apps/backend/internal/testsupport/evidence"
)

func TestProducesPersistedEvidenceAndDeliberateFailure(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	source, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	schema, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "packages", "protocol", "schemas", "ade", "evidence.v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, broken := range []bool{false, true} {
		t.Run(map[bool]string{false: "passing", true: "deliberately-broken"}[broken], func(t *testing.T) {
			// Each independent producer run owns its unchanged two-minute budget.
			// A slow earlier case must not start this case with an expired context.
			ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
			defer cancel()
			output := filepath.Join(t.TempDir(), "evidence")
			args := []string{"--source-root", source.Manifest.Repository, "--output-dir", output}
			if broken {
				args = append(args, "--broken")
			}
			var stdout bytes.Buffer
			runErr := run(ctx, args, &stdout)
			if (runErr != nil) != broken {
				report, _ := os.ReadFile(filepath.Join(output, "report.json"))
				baseline, _ := os.ReadFile(filepath.Join(output, "baseline-check.txt"))
				t.Fatalf("broken=%v error=%v\nreport=%s\nbaseline=%s", broken, runErr, report, baseline)
			}
			data, err := os.ReadFile(filepath.Join(output, "report.json"))
			if err != nil {
				t.Fatal(err)
			}
			report, err := evidence.Decode(schema, data)
			if err != nil {
				t.Fatal(err)
			}
			if len(report.Scenarios) != 5 || report.Scenarios[0].Mode != "simulated" || report.Scenarios[0].Status != map[bool]string{false: "passed", true: "failed"}[broken] {
				t.Fatalf("report %+v", report)
			}
			for _, scenario := range report.Scenarios {
				for _, artifact := range scenario.Artifacts {
					if filepath.IsAbs(artifact) {
						t.Fatalf("absolute artifact %s", artifact)
					}
					if _, err := os.Stat(filepath.Join(output, artifact)); err != nil {
						t.Fatal(err)
					}
				}
			}
			if broken && !strings.Contains(report.Scenarios[0].Reason, "want 42") {
				t.Fatal("broken fixture did not retain actual check failure")
			}
			var ownership ade.Manifest
			manifest, err := os.ReadFile(filepath.Join(output, "ownership.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(manifest, &ownership); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Stat(ownership.Root); !os.IsNotExist(err) {
				t.Fatal("producer left fixture root")
			}
			reportPath, err := filepath.EvalSymlinks(filepath.Join(output, "report.json"))
			if err != nil {
				t.Fatal(err)
			}
			if strings.TrimSpace(stdout.String()) != reportPath {
				t.Fatalf("report path output %q", stdout.String())
			}
		})
	}
}

func TestRejectsOutputInsideSourceRepository(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	err = run(ctx, []string{"--source-root", source.Manifest.Repository, "--output-dir", filepath.Join(source.Manifest.Repository, "evidence")}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "outside source repository") {
		t.Fatalf("unsafe output accepted: %v", err)
	}
	if _, err := os.Stat(filepath.Join(source.Manifest.Repository, "evidence")); !os.IsNotExist(err) {
		t.Fatal("unsafe output created")
	}
}

func TestRejectsTemporaryParentInsideSourceRepository(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	source, err := ade.NewFixture(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	for _, key := range []string{"TMP", "TEMP", "TMPDIR"} {
		t.Setenv(key, source.Manifest.Repository)
	}
	err = run(ctx, []string{"--source-root", source.Manifest.Repository}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "temporary directory must be outside") {
		t.Fatalf("unsafe temp parent accepted: %v", err)
	}
	status, err := source.Git(ctx, source.Manifest.Repository, "status", "--porcelain")
	if err != nil || status != "" {
		t.Fatalf("source changed: %q %v", status, err)
	}
}
