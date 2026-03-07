package workspace

import (
	"strings"
	"testing"
	"time"
)

func TestRunHook_Success(t *testing.T) {
	result, err := RunHook("after_create", "echo hello", t.TempDir(), 2*time.Second)
	if err != nil {
		t.Fatalf("expected hook success, got err=%v", err)
	}

	if strings.TrimSpace(result.Output) != "hello" {
		t.Fatalf("expected hello output, got=%q", result.Output)
	}
}

func TestRunHook_Timeout(t *testing.T) {
	_, err := RunHook("after_create", "sleep 1", t.TempDir(), 10*time.Millisecond)
	if err == nil {
		t.Fatalf("expected timeout error")
	}

	if !strings.Contains(err.Error(), "timeout") {
		t.Fatalf("expected timeout error message, got=%v", err)
	}
}
