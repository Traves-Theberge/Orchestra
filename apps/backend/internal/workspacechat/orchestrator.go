package workspacechat

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/workspace"
)

// ConfigureOrchestrator runs once before serving requests. Its profile directory
// is separate from all registered project roots and does not rewrite home dirs.
func (s *Service) ConfigureOrchestrator(root string, tools []map[string]any, executor agents.ToolExecutor) error {
	if !filepath.IsAbs(root) || executor == nil || len(tools) == 0 {
		return errors.New("orchestrator scope dependencies unavailable")
	}
	// Resolve existing ancestors before creating anything: an old control-folder
	// symlink must not redirect this owned profile outside the backend workspace.
	if filepath.Base(root) != "orchestrator" || filepath.Base(filepath.Dir(root)) != ".orchestra" {
		return errors.New("orchestrator cwd must be the backend-owned control profile")
	}
	if err := workspace.ValidateProjectPath(root, []string{filepath.Dir(filepath.Dir(root))}); err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	if err := provisionMaestroProfile(resolved); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.orchestratorRoot != "" {
		return errors.New("orchestrator scope already configured")
	}
	s.orchestratorRoot = resolved
	s.orchestratorTools = tools
	s.orchestratorExecutor = executor
	return nil
}
func (s *Service) supportsControl(provider agents.Provider) bool {
	r, ok := s.registry.(interface{ SupportsNativeTools(agents.Provider) bool })
	return ok && r.SupportsNativeTools(provider) && s.supportsNative(provider) && s.orchestratorExecutor != nil
}
