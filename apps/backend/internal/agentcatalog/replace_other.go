//go:build !windows

package agentcatalog

import "os"

func replaceFile(source, target string) error {
	return os.Rename(source, target)
}
