package unsandbox

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

// ExtractSessionArtifacts pulls Claude JSONL session files from a container
// session and writes them to the local filesystem where the ingest
// pipeline can pick them up (~/.claude/projects/).
//
// Returns the number of bytes extracted, or 0 if nothing was found.
func ExtractSessionArtifacts(ctx context.Context, client *Client, sessionID string) int {
	// Tar up ~/.claude/projects/ from the container
	cmd := "cd /root/.claude/projects 2>/dev/null && tar czf - . 2>/dev/null | base64 || true"
	result, err := client.ShellSession(ctx, sessionID, cmd)
	if err != nil || result == nil || strings.TrimSpace(result.Output) == "" {
		return 0
	}

	tarData, err := base64.StdEncoding.DecodeString(strings.TrimSpace(result.Output))
	if err != nil || len(tarData) == 0 {
		return 0
	}

	u, err := user.Current()
	if err != nil {
		return 0
	}

	// Extract into ~/.claude/projects/ so the claude-code adapter ingests it
	claudeDir := filepath.Join(u.HomeDir, ".claude", "projects")
	os.MkdirAll(claudeDir, 0755)
	ExtractTarGz(tarData, claudeDir)

	return len(tarData)
}

// ExtractTarGz extracts a gzipped tarball into a directory.
func ExtractTarGz(data []byte, destDir string) error {
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return err
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		target := filepath.Join(destDir, filepath.Clean(header.Name))
		// Prevent path traversal
		if !strings.HasPrefix(target, filepath.Clean(destDir)+string(os.PathSeparator)) && target != filepath.Clean(destDir) {
			continue
		}

		switch header.Typeflag {
		case tar.TypeDir:
			os.MkdirAll(target, 0755)
		case tar.TypeReg:
			os.MkdirAll(filepath.Dir(target), 0755)
			f, err := os.Create(target)
			if err != nil {
				continue
			}
			io.Copy(f, tr)
			f.Close()
		case tar.TypeSymlink:
			os.MkdirAll(filepath.Dir(target), 0755)
			os.Symlink(header.Linkname, target)
		}
	}
	return nil
}
