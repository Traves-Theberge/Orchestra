package api

import (
	"os"
	"path/filepath"
	"testing"
)

// TestMain fences every API test away from real provider configuration and CLI credentials.
func TestMain(m *testing.M) {
	home, err := os.MkdirTemp("", "orchestra-api-home-*")
	if err != nil {
		panic(err)
	}
	for _, key := range []string{"HOME", "USERPROFILE"} {
		os.Setenv(key, home)
	}
	os.Setenv("GH_CONFIG_DIR", filepath.Join(home, "gh"))
	os.Unsetenv("GH_TOKEN")
	os.Unsetenv("GITHUB_TOKEN")
	code := m.Run()
	os.RemoveAll(home)
	os.Exit(code)
}
