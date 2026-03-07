package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/orchestra/orchestra/apps/backend/internal/observability"
)

func (s *Server) GetEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSONError(w, http.StatusInternalServerError, "stream_unsupported", "streaming is not supported by this server")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	once := r.URL.Query().Get("once") == "1"
	writeSnapshotEvent(w, s.orchestrator.Snapshot())
	flusher.Flush()
	if once {
		return
	}

	var sub <-chan observability.Event
	var unsubscribe func()
	if s.pubsub != nil {
		eventCh, unsub := s.pubsub.Subscribe(64)
		sub = eventCh
		unsubscribe = unsub
		defer unsubscribe()
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case eventAny, ok := <-sub:
			if !ok {
				sub = nil
				continue
			}
			writeEventEnvelope(w, eventAny.Type, eventAny)
			writeSnapshotEvent(w, s.orchestrator.Snapshot())
			flusher.Flush()
		case <-ticker.C:
			writeSnapshotEvent(w, s.orchestrator.Snapshot())
			flusher.Flush()
		}
	}
}

func writeSnapshotEvent(w http.ResponseWriter, snapshot any) {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		_, _ = fmt.Fprintf(w, "event: error\ndata: {\"error\":\"snapshot_encode_failed\"}\n\n")
		return
	}

	_, _ = fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", string(encoded))
}

func writeEventEnvelope(w http.ResponseWriter, eventType string, data any) {
	envelope := normalizeEventEnvelope(eventType, data)
	encoded, err := json.Marshal(envelope)
	if err != nil {
		_, _ = fmt.Fprintf(w, "event: error\ndata: {\"error\":\"event_encode_failed\"}\n\n")
		return
	}
	_, _ = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", eventType, string(encoded))
}

func normalizeEventEnvelope(eventType string, data any) observability.Event {
	switch typed := data.(type) {
	case observability.Event:
		if strings.TrimSpace(typed.Type) == "" {
			typed.Type = strings.TrimSpace(eventType)
		}
		if strings.TrimSpace(typed.Timestamp) == "" {
			typed.Timestamp = time.Now().UTC().Format(time.RFC3339)
		}
		return typed
	case *observability.Event:
		if typed != nil {
			copied := *typed
			if strings.TrimSpace(copied.Type) == "" {
				copied.Type = strings.TrimSpace(eventType)
			}
			if strings.TrimSpace(copied.Timestamp) == "" {
				copied.Timestamp = time.Now().UTC().Format(time.RFC3339)
			}
			return copied
		}
	}

	return observability.Event{
		Type:      strings.TrimSpace(eventType),
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data:      data,
	}
}
