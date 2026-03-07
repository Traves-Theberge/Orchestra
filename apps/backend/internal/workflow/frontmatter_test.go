package workflow

import "testing"

func TestParse_WithFrontMatterAndPrompt(t *testing.T) {
	content := "---\nserver:\n  host: 0.0.0.0\nserver_port: 4010\n---\nHello world"

	doc, err := Parse(content)
	if err != nil {
		t.Fatalf("expected parse success, got err=%v", err)
	}

	if doc.Prompt != "Hello world" {
		t.Fatalf("expected prompt to match, got=%q", doc.Prompt)
	}

	server, ok := doc.Config["server"].(map[string]any)
	if !ok {
		t.Fatalf("expected server section")
	}

	if server["host"] != "0.0.0.0" {
		t.Fatalf("expected host override, got=%v", server["host"])
	}
}

func TestParse_WithoutFrontMatter(t *testing.T) {
	content := "No front matter\njust prompt"

	doc, err := Parse(content)
	if err != nil {
		t.Fatalf("expected parse success, got err=%v", err)
	}

	if len(doc.Config) != 0 {
		t.Fatalf("expected empty config map, got=%v", doc.Config)
	}

	if doc.Prompt != "No front matter\njust prompt" {
		t.Fatalf("unexpected prompt: %q", doc.Prompt)
	}
}

func TestParse_InvalidFrontMatterYAMLReturnsError(t *testing.T) {
	content := "---\nserver: [unterminated\n---\nPrompt"

	_, err := Parse(content)
	if err == nil {
		t.Fatalf("expected parse error for invalid yaml")
	}
}

func TestParse_FrontMatterMustBeMap(t *testing.T) {
	content := "---\n- list\n- values\n---\nPrompt"

	_, err := Parse(content)
	if err == nil {
		t.Fatalf("expected parse error for non-map front matter")
	}
}

func TestParse_EmptyFrontMatterAllowed(t *testing.T) {
	content := "---\n---\nPrompt"

	doc, err := Parse(content)
	if err != nil {
		t.Fatalf("expected parse success with empty front matter, got err=%v", err)
	}
	if len(doc.Config) != 0 {
		t.Fatalf("expected empty config map, got=%v", doc.Config)
	}
	if doc.Prompt != "Prompt" {
		t.Fatalf("expected prompt to match, got=%q", doc.Prompt)
	}
}
