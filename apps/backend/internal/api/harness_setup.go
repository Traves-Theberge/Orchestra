package api

import (
	"net/http"
	"os"
	"os/exec"
	"runtime"

	"github.com/orchestra/orchestra/apps/backend/internal/harnesssetup"
)

// GetHarnessSetup reports observations made on the backend host. Registration,
// executable discovery, and provider authentication are independent fields.
func (s *Server) GetHarnessSetup(w http.ResponseWriter, r *http.Request) {
	commands, _ := s.orchestrator.GetAgentConfig()
	rows := harnesssetup.Observe(r.Context(), s.orchestrator.GetProviders(), commands, exec.LookPath, harnesssetup.ProbeCodexAuth)
	_, terminalErr := os.Stat("/bin/bash")
	terminalSupported := runtime.GOOS != "windows" && terminalErr == nil && s.termManager != nil
	for index := range rows {
		rows[index].TerminalSupported = terminalSupported
	}
	writeJSON(w, http.StatusOK, map[string]any{"harnesses": rows})
}
