package workflow

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Document struct {
	Config map[string]any
	Prompt string
}

func LoadFile(path string) (Document, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Document{}, err
	}

	return Parse(string(content))
}

func Parse(content string) (Document, error) {
	frontMatterLines, promptLines := splitFrontMatter(content)
	config, err := decodeFrontMatter(frontMatterLines)
	if err != nil {
		return Document{}, err
	}

	return Document{
		Config: config,
		Prompt: strings.TrimSpace(strings.Join(promptLines, "\n")),
	}, nil
}

func splitFrontMatter(content string) ([]string, []string) {
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return []string{}, lines
	}

	for i := 1; i < len(lines); i++ {
		if strings.TrimSpace(lines[i]) == "---" {
			return lines[1:i], lines[i+1:]
		}
	}

	return lines[1:], []string{}
}

func decodeFrontMatter(lines []string) (map[string]any, error) {
	if strings.TrimSpace(strings.Join(lines, "\n")) == "" {
		return map[string]any{}, nil
	}

	var decoded any
	if err := yaml.Unmarshal([]byte(strings.Join(lines, "\n")), &decoded); err != nil {
		return nil, fmt.Errorf("workflow parse error: %w", err)
	}

	asMap, ok := decoded.(map[string]any)
	if !ok {
		return nil, errors.New("workflow front matter is not a map")
	}

	return asMap, nil
}
