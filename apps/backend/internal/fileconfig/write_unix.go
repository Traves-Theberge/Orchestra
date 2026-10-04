//go:build !windows

package fileconfig

import "os"

func protect(path string, directory bool) error {
	mode := os.FileMode(0600)
	if directory {
		mode = 0700
	}
	return os.Chmod(path, mode)
}

func replace(from, to string) error { return os.Rename(from, to) }
