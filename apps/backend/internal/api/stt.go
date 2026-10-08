package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"github.com/orchestra/orchestra/apps/backend/internal/backgroundcommand"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	maxSTTUploadSize = int64(8 << 20) // 8 MB
	sttTimeout       = 30 * time.Second
)

func (s *Server) GetSTTHealth(w http.ResponseWriter, _ *http.Request) {
	binaryPath, err := resolveWhisperBinary(s.config.STTWhisperBin)
	modelPath := strings.TrimSpace(s.config.STTWhisperModelPath)
	ready := err == nil && modelPath != ""

	if ready {
		if _, statErr := os.Stat(modelPath); statErr != nil {
			ready = false
			err = statErr
		}
	}

	resp := map[string]any{
		"ready":    ready,
		"binary":   binaryPath,
		"model":    modelPath,
		"language": fallbackSTTLanguage(s.config.STTWhisperLanguage),
	}

	if err != nil {
		resp["reason"] = err.Error()
	}

	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) PostSTTTranscribe(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), sttTimeout)
	defer cancel()

	binaryPath, err := resolveWhisperBinary(s.config.STTWhisperBin)
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "stt_unavailable", "whisper binary not found; set ORCHESTRA_STT_WHISPER_BIN")
		return
	}

	modelPath := strings.TrimSpace(s.config.STTWhisperModelPath)
	if modelPath == "" {
		writeJSONError(w, http.StatusServiceUnavailable, "stt_unavailable", "whisper model not configured; set ORCHESTRA_STT_WHISPER_MODEL")
		return
	}
	if _, err := os.Stat(modelPath); err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "stt_unavailable", "configured whisper model path is missing")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxSTTUploadSize)
	if err := r.ParseMultipartForm(maxSTTUploadSize); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_multipart", "failed to parse multipart upload")
		return
	}

	file, header, err := r.FormFile("audio")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "missing_audio", "audio file is required")
		return
	}
	defer file.Close()

	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".wav"
	}
	tmpInput, err := os.CreateTemp("", "orchestra-stt-*"+ext)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "stt_failed", "failed to allocate temp audio file")
		return
	}
	tmpInputPath := tmpInput.Name()
	defer func() { _ = os.Remove(tmpInputPath) }()

	if _, err := io.Copy(tmpInput, file); err != nil {
		_ = tmpInput.Close()
		writeJSONError(w, http.StatusInternalServerError, "stt_failed", "failed to copy audio file")
		return
	}
	if err := tmpInput.Close(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "stt_failed", "failed to finalize audio file")
		return
	}

	tmpPrefix := strings.TrimSuffix(tmpInputPath, ext) + "-out"
	language := fallbackSTTLanguage(firstNonEmpty(strings.TrimSpace(r.FormValue("language")), s.config.STTWhisperLanguage))

	args := []string{"-m", modelPath, "-f", tmpInputPath, "-l", language, "-nt", "-np", "-otxt", "-of", tmpPrefix}
	if s.config.STTWhisperThreads > 0 {
		args = append(args, "-t", fmt.Sprintf("%d", s.config.STTWhisperThreads))
	}

	start := time.Now()
	cmd := backgroundcommand.CommandContext(ctx, binaryPath, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			writeJSONError(w, http.StatusGatewayTimeout, "stt_timeout", "speech transcription timed out")
			return
		}
		s.logger.Error().Err(err).Str("stderr", stderr.String()).Msg("whisper transcription failed")
		writeJSONError(w, http.StatusBadGateway, "stt_failed", "whisper transcription failed")
		return
	}

	txtPath := tmpPrefix + ".txt"
	defer func() { _ = os.Remove(txtPath) }()
	data, err := os.ReadFile(txtPath)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "stt_failed", "whisper did not produce transcript output")
		return
	}

	transcript := strings.TrimSpace(string(data))
	writeJSON(w, http.StatusOK, map[string]any{
		"text":       transcript,
		"elapsed_ms": time.Since(start).Milliseconds(),
		"language":   language,
	})
}

func resolveWhisperBinary(configured string) (string, error) {
	if strings.TrimSpace(configured) != "" {
		return strings.TrimSpace(configured), nil
	}
	for _, candidate := range whisperCandidates() {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("no whisper binary found in PATH")
}

func whisperCandidates() []string {
	if runtime.GOOS == "windows" {
		return []string{"whisper-cli.exe", "main.exe"}
	}
	return []string{"whisper-cli", "main"}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func fallbackSTTLanguage(value string) string {
	if strings.TrimSpace(value) == "" {
		return "en"
	}
	return strings.TrimSpace(value)
}
