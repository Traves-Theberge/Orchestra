package api

import (
	"net/http/httptest"
	"testing"
)

func TestIsTerminalAuthorizedAllowsWhenTokenUnset(t *testing.T) {
	srv := &Server{authToken: ""}
	req := httptest.NewRequest("GET", "/api/v1/terminal/session-1", nil)
	if !srv.isTerminalAuthorized(req) {
		t.Fatalf("expected terminal request authorized when auth token is unset")
	}
}

func TestIsTerminalAuthorizedAcceptsBearerHeader(t *testing.T) {
	srv := &Server{authToken: "top-secret"}
	req := httptest.NewRequest("GET", "/api/v1/terminal/session-1", nil)
	req.Header.Set("Authorization", "Bearer top-secret")
	if !srv.isTerminalAuthorized(req) {
		t.Fatalf("expected terminal request authorized with bearer header")
	}
}

func TestIsTerminalAuthorizedAcceptsTokenQuery(t *testing.T) {
	srv := &Server{authToken: "top-secret"}
	req := httptest.NewRequest("GET", "/api/v1/terminal/session-1?token=top-secret", nil)
	if !srv.isTerminalAuthorized(req) {
		t.Fatalf("expected terminal request authorized with query token")
	}
}

func TestIsTerminalAuthorizedRejectsMissingOrWrongToken(t *testing.T) {
	srv := &Server{authToken: "top-secret"}
	reqMissing := httptest.NewRequest("GET", "/api/v1/terminal/session-1", nil)
	if srv.isTerminalAuthorized(reqMissing) {
		t.Fatalf("expected terminal request denied when token missing")
	}
	reqWrong := httptest.NewRequest("GET", "/api/v1/terminal/session-1?token=wrong", nil)
	if srv.isTerminalAuthorized(reqWrong) {
		t.Fatalf("expected terminal request denied when token is wrong")
	}
}
