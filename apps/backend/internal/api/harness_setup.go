package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"runtime"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/harnesssetup"
	"github.com/orchestra/orchestra/apps/backend/internal/orchestrator"
)

// GetHarnessSetup reports observations made on the backend host. Registration,
// executable discovery, and provider authentication are independent fields.
func (s *Server) GetHarnessSetup(w http.ResponseWriter, r *http.Request) {
	commands, _ := s.orchestrator.GetAgentConfig()
	rows := harnesssetup.Observe(r.Context(), s.orchestrator.GetProviders(), commands, exec.LookPath, harnesssetup.ProbeSupportedAuth)
	_, terminalErr := os.Stat("/bin/bash")
	terminalSupported := runtime.GOOS != "windows" && terminalErr == nil && s.termManager != nil
	for index := range rows {
		rows[index].TerminalSupported = terminalSupported
	}
	for index := range rows {
		version, err := s.orchestrator.HarnessRegistrationVersion(r.Context(), rows[index].ID)
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, "registration_failed", "could not read harness registration")
			return
		}
		rows[index].RegistrationVersion = version
	}
	writeJSON(w, http.StatusOK, map[string]any{"harnesses": rows})
}

// SetHarnessRegistration toggles runner availability without touching credentials or command configuration.
func (s *Server) SetHarnessRegistration(w http.ResponseWriter, r *http.Request) {
	provider := string(agents.NormalizeProvider(chi.URLParam(r, "provider")))
	switch provider {
	case "CODEX", "CLAUDE", "OPENCODE", "ANTIGRAVITY", "8GENT":
	default:
		writeJSONError(w, http.StatusBadRequest, "unknown_harness", "unknown harness")
		return
	}
	var body struct {
		Registered      *bool  `json:"registered"`
		ExpectedVersion *int64 `json:"expected_version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Registered == nil || body.ExpectedVersion == nil || *body.ExpectedVersion < 0 {
		writeJSONError(w, http.StatusBadRequest, "invalid_registration", "registered and expected_version are required")
		return
	}
	version, err := s.orchestrator.SetHarnessRegistration(r.Context(), provider, *body.Registered, *body.ExpectedVersion)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, orchestrator.ErrHarnessRegistrationConflict) {
			status = http.StatusConflict
		}
		if errors.Is(err, orchestrator.ErrDefaultHarness) || errors.Is(err, orchestrator.ErrHarnessCommand) {
			status = http.StatusBadRequest
		}
		writeJSONError(w, status, "registration_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"provider": provider, "registered": *body.Registered, "version": version})
}

func (s *Server) StartCodexDeviceLogin(w http.ResponseWriter, r *http.Request) {
	executable, err := exec.LookPath("codex")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Codex CLI is not installed on the backend host."})
		return
	}
	snapshot, err := s.codexDeviceLogin.Start(r.Context(), executable)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Codex device sign-in could not start. Check the backend CLI and device authentication policy."})
		return
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) GetCodexDeviceLogin(w http.ResponseWriter, r *http.Request) {
	snapshot, found := s.codexDeviceLogin.Get(chi.URLParam(r, "id"))
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device sign-in was not found on this backend host."})
		return
	}
	if snapshot.AccountID != "" && s.accounts != nil && snapshot.State == harnesssetup.DeviceSucceeded {
		if home, err := s.accounts.OwnedHome("CODEX", snapshot.AccountID); err == nil {
			if executable, err := exec.LookPath("codex"); err == nil {
				if state, probeErr := harnesssetup.ProbeCodexAuthInHome(r.Context(), executable, home); probeErr == nil && state == harnesssetup.SignedIn {
					_, _ = s.accounts.Complete(snapshot.AccountID)
				} else {
					snapshot.Message = "Device flow completed; account status is not yet verified. Use Verify before selecting it."
				}
			}
		}
	}
	if snapshot.AccountID != "" && s.accounts != nil && (snapshot.State == harnesssetup.DeviceFailed || snapshot.State == harnesssetup.DeviceCanceled || snapshot.State == harnesssetup.DeviceExpired) {
		if account, err := s.accounts.Get(snapshot.AccountID); err == nil && account.State == "pending" {
			_ = s.accounts.Remove(snapshot.AccountID)
		}
	}
	writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) CancelCodexDeviceLogin(w http.ResponseWriter, r *http.Request) {
	if !s.codexDeviceLogin.Cancel(chi.URLParam(r, "id")) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Device sign-in was not found on this backend host."})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
