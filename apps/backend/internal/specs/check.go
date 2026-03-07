package specs

import (
	"fmt"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/config"
	"github.com/orchestra/orchestra/apps/backend/internal/workflow"
)

func Check() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config load failed: %w", err)
	}

	if strings.TrimSpace(cfg.AgentProvider) == "" {
		return fmt.Errorf("agent provider is missing")
	}
	if _, ok := cfg.AgentCommands[cfg.AgentProvider]; !ok {
		return fmt.Errorf("agent command missing for provider %s", cfg.AgentProvider)
	}

	doc, err := workflow.LoadFile(cfg.WorkflowFile)
	if err != nil {
		return fmt.Errorf("workflow load failed: %w", err)
	}
	if strings.TrimSpace(doc.Prompt) == "" {
		return fmt.Errorf("workflow prompt body is empty")
	}

	return nil
}
