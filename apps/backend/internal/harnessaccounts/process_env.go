package harnessaccounts

import "os"

// CodexProcessEnv keeps an isolated login/probe/quota process out of unrelated
// provider and backend secrets. Credential storage is selected by CODEX_HOME.
func CodexProcessEnv(home string) []string {
	keys := []string{"PATH", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"}
	env := make([]string, 0, len(keys)+1)
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			env = append(env, key+"="+value)
		}
	}
	return append(env, "CODEX_HOME="+home)
}
