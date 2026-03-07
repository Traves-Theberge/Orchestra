package specs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLintPRBodyValid(t *testing.T) {
	template := "#### Summary\n\n- item\n\n#### Checklist\n\n- [ ] task\n"
	body := "#### Summary\n\n- done\n\n#### Checklist\n\n- [x] complete\n"
	headings := extractHeadings(template)

	errors := lintPRBody(template, body, headings)
	if len(errors) != 0 {
		t.Fatalf("expected no lint errors, got %+v", errors)
	}
}

func TestLintPRBodyDetectsMissingHeadingAndPlaceholder(t *testing.T) {
	template := "#### Summary\n\n- item\n\n#### Checklist\n\n- [ ] task\n"
	body := "#### Summary\n\n- done\n\n<!-- TODO -->\n"
	headings := extractHeadings(template)

	errors := lintPRBody(template, body, headings)
	if len(errors) < 2 {
		t.Fatalf("expected at least two lint errors, got %+v", errors)
	}
}

func TestCaptureSection(t *testing.T) {
	doc := "#### A\n\nalpha\n#### B\n\nbeta"
	headings := []string{"#### A", "#### B"}

	section := captureSection(doc, "#### A", headings)
	if section == "" {
		t.Fatalf("expected section content")
	}
}

func TestCheckPRBodyEndToEndValid(t *testing.T) {
	temp := t.TempDir()
	githubDir := filepath.Join(temp, ".github")
	if err := os.MkdirAll(githubDir, 0o755); err != nil {
		t.Fatalf("mkdir .github: %v", err)
	}
	templatePath := filepath.Join(githubDir, "pull_request_template.md")
	template := "#### Summary\n\n- item\n\n#### Checklist\n\n- [ ] task\n"
	if err := os.WriteFile(templatePath, []byte(template), 0o644); err != nil {
		t.Fatalf("write template: %v", err)
	}
	bodyPath := filepath.Join(temp, "pr_body.md")
	body := "#### Summary\n\n- done\n\n#### Checklist\n\n- [x] complete\n"
	if err := os.WriteFile(bodyPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write body: %v", err)
	}

	originalCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() { _ = os.Chdir(originalCwd) }()
	if err := os.Chdir(temp); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	if err := CheckPRBody(bodyPath); err != nil {
		t.Fatalf("expected check-pr-body success, got %v", err)
	}
}

func TestCheckPRBodyEndToEndReportsTemplateViolations(t *testing.T) {
	temp := t.TempDir()
	githubDir := filepath.Join(temp, ".github")
	if err := os.MkdirAll(githubDir, 0o755); err != nil {
		t.Fatalf("mkdir .github: %v", err)
	}
	templatePath := filepath.Join(githubDir, "pull_request_template.md")
	template := "#### Summary\n\n- item\n\n#### Checklist\n\n- [ ] task\n"
	if err := os.WriteFile(templatePath, []byte(template), 0o644); err != nil {
		t.Fatalf("write template: %v", err)
	}
	bodyPath := filepath.Join(temp, "pr_body.md")
	body := "#### Summary\n\njust text\n"
	if err := os.WriteFile(bodyPath, []byte(body), 0o644); err != nil {
		t.Fatalf("write body: %v", err)
	}

	originalCwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	defer func() { _ = os.Chdir(originalCwd) }()
	if err := os.Chdir(temp); err != nil {
		t.Fatalf("chdir: %v", err)
	}

	err = CheckPRBody(bodyPath)
	if err == nil {
		t.Fatalf("expected check-pr-body failure")
	}
	if !strings.Contains(err.Error(), "missing required heading") {
		t.Fatalf("expected missing heading error, got %v", err)
	}
}
