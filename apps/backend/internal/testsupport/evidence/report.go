// Package evidence validates ADE reports without promoting simulated checks to real execution.
package evidence

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/xeipuuv/gojsonschema"
)

type Source struct {
	Revision        string `json:"revision"`
	TreeFingerprint string `json:"tree_fingerprint"`
}

type Environment struct {
	OS              string            `json:"os"`
	Arch            string            `json:"arch"`
	RuntimeVersions map[string]string `json:"runtime_versions"`
	Provider        string            `json:"provider"`
	ProviderVersion string            `json:"provider_version"`
	Model           string            `json:"model"`
	Tracker         string            `json:"tracker"`
	RuntimeTarget   string            `json:"runtime_target"`
}

type Scenario struct {
	ID             string   `json:"id"`
	Status         string   `json:"status"`
	Mode           string   `json:"mode"`
	Boundaries     []string `json:"boundaries"`
	Artifacts      []string `json:"artifacts"`
	DurationMS     int64    `json:"duration_ms"`
	Reason         string   `json:"reason,omitempty"`
	TaskID         string   `json:"task_id,omitempty"`
	RunID          string   `json:"run_id,omitempty"`
	AttemptID      string   `json:"attempt_id,omitempty"`
	SessionID      string   `json:"session_id,omitempty"`
	TestedRevision string   `json:"tested_revision,omitempty"`
}

type Report struct {
	Version       int         `json:"report_version"`
	Source        Source      `json:"source"`
	Environment   Environment `json:"environment"`
	FixtureID     string      `json:"fixture_id"`
	GeneratedAt   time.Time   `json:"generated_at"`
	OverallStatus string      `json:"overall_status"`
	Scenarios     []Scenario  `json:"scenarios"`
}

type Requirement struct {
	ID           string   `json:"id"`
	Mode         string   `json:"mode"`
	Boundaries   []string `json:"boundaries"`
	MinArtifacts int      `json:"min_artifacts,omitempty"`
}

// Expectations come from the caller's acceptance profile, never the report itself.
type Expectations struct {
	Source      Source        `json:"source"`
	Environment Environment   `json:"environment"`
	Scenarios   []Requirement `json:"scenarios"`
	Now         time.Time     `json:"-"`
}

// Decode validates structure and internal consistency. A failed report can be valid evidence.
func Decode(schema, data []byte) (Report, error) {
	var report Report
	result, err := gojsonschema.Validate(gojsonschema.NewBytesLoader(schema), gojsonschema.NewBytesLoader(data))
	if err != nil {
		return report, fmt.Errorf("validate evidence schema: %w", err)
	}
	if !result.Valid() {
		var problems []string
		for _, problem := range result.Errors() {
			problems = append(problems, problem.String())
		}
		return report, fmt.Errorf("invalid evidence: %s", strings.Join(problems, "; "))
	}
	if err := json.Unmarshal(data, &report); err != nil {
		return report, err
	}
	seen := make(map[string]bool)
	allPassed := true
	for _, scenario := range report.Scenarios {
		if seen[scenario.ID] {
			return report, fmt.Errorf("duplicate scenario %q", scenario.ID)
		}
		seen[scenario.ID] = true
		if scenario.Status != "passed" {
			allPassed = false
			if strings.TrimSpace(scenario.Reason) == "" {
				return report, fmt.Errorf("scenario %q requires a non-pass reason", scenario.ID)
			}
		}
	}
	if (report.OverallStatus == "passed") != allPassed {
		return report, fmt.Errorf("overall status disagrees with scenario outcomes")
	}
	return report, nil
}

// Check accepts only fresh, passing evidence for the exact requested scope and source tree.
func Check(report Report, expected Expectations) error {
	if report.Version != 1 {
		return fmt.Errorf("unsupported evidence version")
	}
	if len(expected.Scenarios) == 0 {
		return fmt.Errorf("acceptance profile has no required scenarios")
	}
	if expected.Now.IsZero() {
		return fmt.Errorf("acceptance profile requires an explicit current time")
	}
	if expected.Source.Revision == "" || expected.Source.TreeFingerprint == "" {
		return fmt.Errorf("acceptance profile requires revision and source tree fingerprint")
	}
	if report.Source != expected.Source {
		return fmt.Errorf("evidence source revision or tree fingerprint differs")
	}
	if report.GeneratedAt.IsZero() || report.GeneratedAt.After(expected.Now.Add(time.Minute)) || expected.Now.Sub(report.GeneratedAt) > 24*time.Hour {
		return fmt.Errorf("evidence is stale, missing a timestamp or in the future")
	}
	if report.OverallStatus != "passed" {
		return fmt.Errorf("evidence is %s, not passed", report.OverallStatus)
	}
	if expected.Environment.OS == "" || expected.Environment.Arch == "" || expected.Environment.Provider == "" || expected.Environment.ProviderVersion == "" || expected.Environment.Model == "" || expected.Environment.Tracker == "" || expected.Environment.RuntimeTarget == "" || len(expected.Environment.RuntimeVersions) == 0 {
		return fmt.Errorf("acceptance profile requires a complete environment scope")
	}
	actual, want := report.Environment, expected.Environment
	if actual.OS != want.OS || actual.Arch != want.Arch || actual.Provider != want.Provider || actual.ProviderVersion != want.ProviderVersion || actual.Model != want.Model || actual.Tracker != want.Tracker || actual.RuntimeTarget != want.RuntimeTarget {
		return fmt.Errorf("evidence environment differs from acceptance scope")
	}
	for name, version := range want.RuntimeVersions {
		if strings.TrimSpace(name) == "" || strings.TrimSpace(version) == "" {
			return fmt.Errorf("acceptance profile contains an empty runtime name/version")
		}
		if actual.RuntimeVersions[name] != version {
			return fmt.Errorf("runtime %q differs from acceptance scope", name)
		}
	}
	seen := make(map[string]Scenario)
	for _, scenario := range report.Scenarios {
		if _, exists := seen[scenario.ID]; exists {
			return fmt.Errorf("duplicate scenario %q", scenario.ID)
		}
		if scenario.Status != "passed" {
			return fmt.Errorf("scenario %q is %s", scenario.ID, scenario.Status)
		}
		seen[scenario.ID] = scenario
	}
	requested := make(map[string]bool)
	for _, requirement := range expected.Scenarios {
		if requirement.ID == "" || requested[requirement.ID] || (requirement.Mode != "simulated" && requirement.Mode != "real") || len(requirement.Boundaries) == 0 || requirement.MinArtifacts < 0 {
			return fmt.Errorf("invalid acceptance requirement %q", requirement.ID)
		}
		requested[requirement.ID] = true
		scenario, exists := seen[requirement.ID]
		if !exists {
			return fmt.Errorf("required scenario %q is absent", requirement.ID)
		}
		if scenario.Mode != requirement.Mode {
			return fmt.Errorf("scenario %q has wrong execution mode", requirement.ID)
		}
		if len(scenario.Artifacts) < requirement.MinArtifacts {
			return fmt.Errorf("scenario %q lacks required artifacts", requirement.ID)
		}
		for _, boundary := range requirement.Boundaries {
			if strings.TrimSpace(boundary) == "" || !contains(scenario.Boundaries, boundary) {
				return fmt.Errorf("scenario %q lacks boundary %q", requirement.ID, boundary)
			}
		}
	}
	return nil
}

func contains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}
