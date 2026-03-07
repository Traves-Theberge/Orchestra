package runtime

import (
	"net"
	"strings"
)

const (
	ServiceOrchestrator = "orchestra.orchestrator"
	ServiceDashboard    = "orchestra.dashboard"
)

func HostRequiresToken(host string) bool {
	trimmed := strings.TrimSpace(strings.Trim(host, "[]"))
	if trimmed == "" {
		return false
	}
	if strings.EqualFold(trimmed, "localhost") {
		return false
	}
	ip := net.ParseIP(trimmed)
	if ip == nil {
		return true
	}
	if ip.IsLoopback() {
		return false
	}
	return true
}
