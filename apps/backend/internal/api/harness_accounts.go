package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/orchestra/orchestra/apps/backend/internal/harnessaccounts"
	"github.com/orchestra/orchestra/apps/backend/internal/harnesssetup"
	"github.com/orchestra/orchestra/apps/backend/internal/workspacechat"
)

func (s *Server) accountStore(w http.ResponseWriter) bool {
	if s.accounts == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Managed accounts are unavailable on this backend."})
		return false
	}
	return true
}
func (s *Server) ListHarnessAccounts(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	accounts, selections := s.accounts.List()
	if accounts == nil {
		accounts = []harnessaccounts.Account{}
	}
	if selections == nil {
		selections = []harnessaccounts.Selection{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"accounts": accounts, "selections": selections, "supported_providers": []string{"CODEX"}, "source": "backend_host", "observed_at": time.Now().UTC().Format(time.RFC3339)})
}
func (s *Server) BeginHarnessAccount(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	var body struct {
		Provider string `json:"provider"`
		Label    string `json:"label"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil || strings.ToUpper(body.Provider) != "CODEX" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Only Codex managed sign-in is supported."})
		return
	}
	executable, err := exec.LookPath("codex")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Codex CLI is not installed on this backend."})
		return
	}
	account, home, err := s.accounts.BeginCodex(body.Label)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	login, err := s.codexDeviceLogin.StartInHome(r.Context(), executable, home, account.ID)
	if err != nil {
		_ = s.accounts.Remove(account.ID)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Codex device sign-in could not start."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"account": account, "login": login})
}
func (s *Server) ReauthHarnessAccount(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	id := chi.URLParam(r, "id")
	home, err := s.accounts.OwnedHome("CODEX", id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Account not found."})
		return
	}
	executable, err := exec.LookPath("codex")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Codex CLI is not installed."})
		return
	}
	login, err := s.codexDeviceLogin.StartInHome(r.Context(), executable, home, id)
	if err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "A Codex sign-in is already in progress."})
		return
	}
	writeJSON(w, http.StatusOK, login)
}
func (s *Server) VerifyHarnessAccount(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	id := chi.URLParam(r, "id")
	home, err := s.accounts.OwnedHome("CODEX", id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Account not found."})
		return
	}
	executable, err := exec.LookPath("codex")
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Codex CLI is not installed."})
		return
	}
	observed, err := harnesssetup.ProbeCodexAuthInHome(r.Context(), executable, home)
	state := "unknown"
	if err == nil {
		state = string(observed)
	}
	account, markErr := s.accounts.Mark(id, state)
	if markErr != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not persist account status."})
		return
	}
	writeJSON(w, http.StatusOK, account)
}
func (s *Server) SelectHarnessAccount(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	var body struct {
		AccountID string `json:"account_id"`
		Version   int64  `json:"version"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid selection."})
		return
	}
	selection, err := s.accounts.Select(chi.URLParam(r, "provider"), body.AccountID, body.Version)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, harnessaccounts.ErrConflict) {
			status = http.StatusConflict
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	if s.usageService != nil {
		s.usageService.InvalidateRateLimits()
	}
	writeJSON(w, http.StatusOK, selection)
}
func (s *Server) RemoveHarnessAccount(w http.ResponseWriter, r *http.Request) {
	if !s.accountStore(w) {
		return
	}
	id := chi.URLParam(r, "id")
	if s.orchestrator != nil {
		snapshot := s.orchestrator.Snapshot()
		for _, run := range snapshot.Running {
			if run.AccountID == id {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "Account is bound to a task run."})
				return
			}
		}
		for _, retry := range snapshot.Retrying {
			if retry.AccountID == id {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "Account is bound to a task retry."})
				return
			}
		}
	}
	var err error
	if s.workspaceChat != nil {
		err = s.workspaceChat.RemoveIdleAccount(r.Context(), id, func() error { return s.accounts.Remove(id) })
	} else {
		err = s.accounts.Remove(id)
	}
	if err != nil {
		status := http.StatusConflict
		if errors.Is(err, harnessaccounts.ErrNotFound) {
			status = http.StatusNotFound
		} else if !errors.Is(err, harnessaccounts.ErrConflict) && !errors.Is(err, workspacechat.ErrBusy) {
			status = http.StatusInternalServerError
		}
		writeJSON(w, status, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
