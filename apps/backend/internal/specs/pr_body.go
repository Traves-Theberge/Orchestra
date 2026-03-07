package specs

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

var prTemplateCandidates = []string{
	".github/pull_request_template.md",
	"../.github/pull_request_template.md",
}

func CheckPRBody(filePath string) error {
	if strings.TrimSpace(filePath) == "" {
		return fmt.Errorf("missing required --file path")
	}

	templatePath, template, err := readPRTemplate()
	if err != nil {
		return err
	}

	bodyRaw, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("unable to read %s: %w", filePath, err)
	}
	body := string(bodyRaw)

	headings := extractHeadings(template)
	if len(headings) == 0 {
		return fmt.Errorf("no markdown headings found in %s", templatePath)
	}

	errors := lintPRBody(template, body, headings)
	if len(errors) == 0 {
		return nil
	}

	return fmt.Errorf("PR body format invalid:\n- %s", strings.Join(errors, "\n- "))
}

func readPRTemplate() (string, string, error) {
	for _, path := range prTemplateCandidates {
		raw, err := os.ReadFile(path)
		if err == nil {
			return path, string(raw), nil
		}
	}
	return "", "", fmt.Errorf("unable to read PR template from candidates: %s", strings.Join(prTemplateCandidates, ", "))
}

func extractHeadings(template string) []string {
	re := regexp.MustCompile(`(?m)^#{4,6}\s+.+$`)
	matches := re.FindAllString(template, -1)
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		trimmed := strings.TrimSpace(match)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func lintPRBody(template string, body string, headings []string) []string {
	errors := make([]string, 0)

	positions := make([]int, 0, len(headings))
	for _, heading := range headings {
		idx := strings.Index(body, heading)
		if idx < 0 {
			errors = append(errors, fmt.Sprintf("missing required heading: %s", heading))
			continue
		}
		positions = append(positions, idx)
	}

	sorted := append([]int(nil), positions...)
	sort.Ints(sorted)
	for i := range positions {
		if positions[i] != sorted[i] {
			errors = append(errors, "required headings are out of order")
			break
		}
	}

	if strings.Contains(body, "<!--") {
		errors = append(errors, "PR description still contains template placeholder comments (<!-- ... -->)")
	}

	for _, heading := range headings {
		templateSection := captureSection(template, heading, headings)
		bodySection := captureSection(body, heading, headings)
		if bodySection == "" {
			continue
		}

		if strings.TrimSpace(bodySection) == "" {
			errors = append(errors, fmt.Sprintf("section cannot be empty: %s", heading))
			continue
		}

		if requiresBullets(templateSection) && !hasBullets(bodySection) {
			errors = append(errors, fmt.Sprintf("section must include at least one bullet item: %s", heading))
		}
		if requiresCheckboxes(templateSection) && !hasCheckboxes(bodySection) {
			errors = append(errors, fmt.Sprintf("section must include at least one checkbox item: %s", heading))
		}
	}

	return errors
}

func captureSection(doc string, heading string, headings []string) string {
	headingIdx := strings.Index(doc, heading)
	if headingIdx < 0 {
		return ""
	}
	contentStart := headingIdx + len(heading)
	if contentStart+2 > len(doc) {
		return ""
	}
	if doc[contentStart:contentStart+2] != "\n\n" {
		return ""
	}
	content := doc[contentStart+2:]
	boundaries := make([]int, 0, len(headings))
	for _, other := range headings {
		if other == heading {
			continue
		}
		marker := "\n" + other
		if idx := strings.Index(content, marker); idx >= 0 {
			boundaries = append(boundaries, idx)
		}
	}
	if len(boundaries) == 0 {
		return content
	}
	sort.Ints(boundaries)
	return content[:boundaries[0]]
}

func requiresBullets(section string) bool {
	re := regexp.MustCompile(`(?m)^- `)
	return re.MatchString(section)
}

func hasBullets(section string) bool {
	re := regexp.MustCompile(`(?m)^- `)
	return re.MatchString(section)
}

func requiresCheckboxes(section string) bool {
	re := regexp.MustCompile(`(?m)^- \[ \] `)
	return re.MatchString(section)
}

func hasCheckboxes(section string) bool {
	re := regexp.MustCompile(`(?m)^- \[[ xX]\] `)
	return re.MatchString(section)
}
