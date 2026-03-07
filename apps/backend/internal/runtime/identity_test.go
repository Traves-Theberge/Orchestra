package runtime

import "testing"

func TestHostRequiresToken(t *testing.T) {
	testCases := []struct {
		host     string
		requires bool
	}{
		{host: "127.0.0.1", requires: false},
		{host: "::1", requires: false},
		{host: "localhost", requires: false},
		{host: "0.0.0.0", requires: true},
		{host: "10.0.0.5", requires: true},
		{host: "example.internal", requires: true},
	}

	for _, tc := range testCases {
		if got := HostRequiresToken(tc.host); got != tc.requires {
			t.Fatalf("HostRequiresToken(%q) = %v, want %v", tc.host, got, tc.requires)
		}
	}
}
