package unsandbox

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	// ChunkSize must be a multiple of 3 so base64 blocks are self-contained (no padding split).
	// 9 MB raw → ~12 MB base64 per request.
	ChunkSize = 9 * 1024 * 1024
	// MaxUploadSize is the maximum tarball size to inject.
	MaxUploadSize = 50 * 1024 * 1024
)

// InjectDirectory tars a local directory, base64-encodes it in chunks, and
// streams it into an unsandbox session via heredoc shell commands.
// The tarball lands at /tmp/input/{name}.tar.gz then gets extracted to destDir.
//
// This uses a chunked heredoc injection pattern for reliable transfer.
func (c *Client) InjectDirectory(ctx context.Context, sessionID, localDir, destDir string) error {
	// Create tarball in memory
	tarBuf, err := tarDirectory(localDir)
	if err != nil {
		return fmt.Errorf("tar %s: %w", localDir, err)
	}

	if tarBuf.Len() > MaxUploadSize {
		return fmt.Errorf("project too large (%d bytes, max %d)", tarBuf.Len(), MaxUploadSize)
	}

	name := filepath.Base(localDir)
	remoteTar := fmt.Sprintf("/tmp/input/%s.tar.gz", name)

	// Split into chunks and send via heredoc
	data := tarBuf.Bytes()
	for i := 0; i < len(data); i += ChunkSize {
		end := i + ChunkSize
		if end > len(data) {
			end = len(data)
		}
		chunk := data[i:end]
		b64 := base64.StdEncoding.EncodeToString(chunk)

		redirect := ">>"
		prefix := ""
		if i == 0 {
			redirect = ">"
			prefix = "mkdir -p /tmp/input\n"
		}

		cmd := fmt.Sprintf("%sbase64 -d << 'UNSB_EOF' %s '%s'\n%s\nUNSB_EOF", prefix, redirect, remoteTar, b64)
		if _, err := c.ShellSession(ctx, sessionID, cmd); err != nil {
			return fmt.Errorf("inject chunk at offset %d: %w", i, err)
		}
	}

	// Extract into destination
	extractCmd := fmt.Sprintf("mkdir -p '%s' && tar xzf '%s' -C '%s' && rm -f '%s'", destDir, remoteTar, destDir, remoteTar)
	if _, err := c.ShellSession(ctx, sessionID, extractCmd); err != nil {
		return fmt.Errorf("extract tarball: %w", err)
	}

	return nil
}

// tarDirectory creates a gzipped tar of a directory, preserving relative paths.
// Skips .git internals (sends .git/config and .git/HEAD only for branch detection),
// node_modules, and other large dirs.
func tarDirectory(dir string) (*bytes.Buffer, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gw)

	skipDirs := map[string]bool{
		"node_modules": true,
		".venv":        true,
		"__pycache__":  true,
		".next":        true,
		"dist":         true,
		"build":        true,
		".orchestra":   true,
	}

	base := filepath.Clean(dir)

	err := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip unreadable
		}

		rel, _ := filepath.Rel(base, path)
		if rel == "." {
			return nil
		}

		// Skip large/unnecessary directories
		name := filepath.Base(path)
		if info.IsDir() {
			if skipDirs[name] {
				return filepath.SkipDir
			}
			// Only include .git/config and .git/HEAD, skip the rest of .git
			if name == ".git" {
				// We'll handle .git specially — don't recurse
				for _, gitFile := range []string{"config", "HEAD"} {
					gfPath := filepath.Join(path, gitFile)
					gfInfo, err := os.Stat(gfPath)
					if err != nil {
						continue
					}
					gfRel := filepath.Join(rel, gitFile)
					header, err := tar.FileInfoHeader(gfInfo, "")
					if err != nil {
						continue
					}
					header.Name = gfRel
					if err := tw.WriteHeader(header); err != nil {
						continue
					}
					f, err := os.Open(gfPath)
					if err != nil {
						continue
					}
					io.Copy(tw, f)
					f.Close()
				}
				return filepath.SkipDir
			}
			return nil
		}

		// Skip large files
		if info.Size() > 10*1024*1024 {
			return nil
		}

		// Skip binaries and common non-essential files
		if strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".so") || strings.HasSuffix(name, ".dylib") {
			return nil
		}

		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return nil
		}
		header.Name = rel

		if err := tw.WriteHeader(header); err != nil {
			return err
		}

		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()

		_, err = io.Copy(tw, f)
		return err
	})
	if err != nil {
		return nil, err
	}

	tw.Close()
	gw.Close()
	return &buf, nil
}
