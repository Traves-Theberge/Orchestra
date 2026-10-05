package workspacechat

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"io"
	"strings"

	"github.com/orchestra/orchestra/apps/backend/internal/agents"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

type nativeRegistry interface {
	SupportsNativeSession(agents.Provider) bool
	StartNativeSession(context.Context, agents.Provider, agents.TurnRequest, string, agents.NativeEventHandler) (agents.NativeSession, error)
}

// Provider Close may be reentrant from its callback and therefore cannot join
// that callback worker itself. Service callbacks only persist observations;
// disposal occurs outside their worker and outside the service mutex.
type nativeEventDrainer interface{ DrainEvents(context.Context) error }

func closeNative(native agents.NativeSession) {
	_ = native.Close()
	if drainer, ok := native.(nativeEventDrainer); ok {
		_ = drainer.DrainEvents(context.Background())
	}
}

type ChatEvent struct {
	Sequence int64 `json:"sequence"`
	agents.NativeEvent
	CreatedAt string `json:"created_at"`
}
type RuntimeRequest struct {
	ID               string          `json:"id"`
	TurnID           string          `json:"turn_id"`
	Method           string          `json:"method"`
	Params           json.RawMessage `json:"params"`
	Status           string          `json:"status"`
	Answer           json.RawMessage `json:"answer,omitempty"`
	ClientResponseID string          `json:"client_response_id,omitempty"`
	CreatedAt        string          `json:"created_at"`
}
type ReplyRequest struct {
	ClientResponseID string          `json:"client_response_id"`
	Answer           json.RawMessage `json:"answer"`
}

func migrateNative(d *db.DB) error {
	_, err := d.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_native(session_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL DEFAULT '',requested_model TEXT NOT NULL DEFAULT '',effective_model TEXT NOT NULL DEFAULT '',approval_policy TEXT NOT NULL DEFAULT '',sandbox_mode TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS workspace_chat_submissions(message_id TEXT PRIMARY KEY,requested_model TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS workspace_chat_submission_efforts(message_id TEXT PRIMARY KEY,effort TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS workspace_chat_efforts(session_id TEXT PRIMARY KEY,requested TEXT NOT NULL DEFAULT '',observed TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS workspace_chat_modes(session_id TEXT PRIMARY KEY,mode TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_chat_events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL,event TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_chat_requests(session_id TEXT NOT NULL,id TEXT NOT NULL,turn_id TEXT NOT NULL,method TEXT NOT NULL,params TEXT NOT NULL,status TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',client_response_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,PRIMARY KEY(session_id,id));
	 UPDATE workspace_chat_requests SET status='unknown' WHERE status IN ('pending','sending');`)
	if err != nil {
		return err
	}
	rows, err := d.Query(`PRAGMA table_info(workspace_chat_native)`)
	if err != nil {
		return err
	}
	hasCounter := false
	for rows.Next() {
		var cid, notNull, primary int
		var name, dataType string
		var defaultValue any
		if err = rows.Scan(&cid, &name, &dataType, &notNull, &defaultValue, &primary); err != nil {
			rows.Close()
			return err
		}
		if name == "cumulative_turn_count" {
			hasCounter = true
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if !hasCounter {
		_, err = d.Exec(`ALTER TABLE workspace_chat_native ADD COLUMN cumulative_turn_count INTEGER`)
	}
	return err
}
func (s *Service) supportsNative(p agents.Provider) bool {
	n, ok := s.registry.(nativeRegistry)
	return ok && n.SupportsNativeSession(p)
}
func (s *Service) decorate(ctx context.Context, v *Session) error {
	v.AccountID = "system_default"
	if e := s.db.QueryRowContext(ctx, `SELECT account_id FROM workspace_chat_account_bindings WHERE session_id=?`, v.ID).Scan(&v.AccountID); e != nil && !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	var mode string
	if e := s.db.QueryRowContext(ctx, `SELECT mode FROM workspace_chat_modes WHERE session_id=?`, v.ID).Scan(&mode); e == nil {
		v.ConversationMode = mode
	} else if !errors.Is(e, sql.ErrNoRows) {
		return e
	}
	err := s.db.QueryRowContext(ctx, `SELECT thread_id,requested_model,effective_model,approval_policy,sandbox_mode FROM workspace_chat_native WHERE session_id=?`, v.ID).Scan(&v.ProviderThreadID, &v.RequestedModel, &v.EffectiveModel, &v.ApprovalPolicy, &v.SandboxMode)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	if err != nil {
		return err
	}
	err = s.db.QueryRowContext(ctx, `SELECT requested,observed FROM workspace_chat_efforts WHERE session_id=?`, v.ID).Scan(&v.RequestedReasoningEffort, &v.EffectiveReasoningEffort)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	}
	if err != nil {
		return err
	}
	err = s.db.QueryRowContext(ctx, `SELECT requested_agent_id,scope,content_hash,format,effective_agent_id,observation FROM workspace_chat_agent_selection WHERE session_id=?`, v.ID).Scan(&v.RequestedAgentID, &v.RequestedAgentScope, &v.RequestedAgentContentHash, &v.RequestedAgentFormat, &v.EffectiveAgentID, &v.AgentObservation)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	return err
}
func (s *Service) loadNative(ctx context.Context, d *Detail, after int64) error {
	d.Events = []ChatEvent{}
	d.Requests = []RuntimeRequest{}
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence),0) FROM workspace_chat_events WHERE session_id=?`, d.Session.ID).Scan(&d.Cursor); err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT sequence,event,created_at FROM workspace_chat_events WHERE session_id=? AND sequence>? ORDER BY sequence`, d.Session.ID, after)
	if err != nil {
		return err
	}
	for rows.Next() {
		var e ChatEvent
		var raw string
		if err = rows.Scan(&e.Sequence, &raw, &e.CreatedAt); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal([]byte(raw), &e.NativeEvent); err != nil {
			rows.Close()
			return err
		}
		d.Events = append(d.Events, e)
		if e.Sequence > d.Cursor {
			d.Cursor = e.Sequence
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = s.db.QueryContext(ctx, `SELECT id,turn_id,method,params,status,answer,client_response_id,created_at FROM workspace_chat_requests WHERE session_id=? ORDER BY created_at`, d.Session.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var r RuntimeRequest
		var params, answer string
		if err = rows.Scan(&r.ID, &r.TurnID, &r.Method, &params, &r.Status, &answer, &r.ClientResponseID, &r.CreatedAt); err != nil {
			return err
		}
		r.Params = json.RawMessage(params)
		if answer != "" {
			r.Answer = json.RawMessage(answer)
		}
		d.Requests = append(d.Requests, r)
	}
	return rows.Err()
}
func (s *Service) recordEvent(id string, e agents.NativeEvent) error {
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if e.ThreadID != "" {
		var expected string
		if err = tx.QueryRow(`SELECT thread_id FROM workspace_chat_native WHERE session_id=?`, id).Scan(&expected); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if expected != "" && expected != e.ThreadID {
			return nil
		}
	}
	if _, err = tx.Exec(`INSERT INTO workspace_chat_events(session_id,event,created_at) VALUES(?,?,?)`, id, string(raw), stamp()); err != nil {
		return err
	}
	if e.Type == "server_request" {
		var p struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err = json.Unmarshal(e.Payload, &p); err != nil {
			return err
		}
		if e.RequestID == "" || p.Method == "" || len(p.Params) == 0 {
			return fmt.Errorf("invalid provider request")
		}
		status := "stale"
		var sessionStatus string
		var terminal int
		if err = tx.QueryRow(`SELECT status FROM workspace_chat_sessions WHERE id=?`, id).Scan(&sessionStatus); err != nil {
			return err
		}
		if err = tx.QueryRow(`SELECT COUNT(*) FROM workspace_chat_events WHERE session_id=? AND json_extract(event,'$.type')='turn/completed' AND json_extract(event,'$.turn_id')=?`, id, e.TurnID).Scan(&terminal); err != nil {
			return err
		}
		if sessionStatus == "running" && terminal == 0 {
			status = "pending"
		}
		if _, err = tx.Exec(`INSERT INTO workspace_chat_requests(session_id,id,turn_id,method,params,status,created_at) VALUES(?,?,?,?,?,?,?)`, id, e.RequestID, e.TurnID, p.Method, string(p.Params), status, stamp()); err != nil {
			return err
		}
	}
	if e.Type == "turn/completed" && e.TurnID != "" {
		if _, err = tx.Exec(`UPDATE workspace_chat_requests SET status='stale' WHERE session_id=? AND turn_id=? AND status='pending'`, id, e.TurnID); err != nil {
			return err
		}
	}
	if e.Type == "serverRequest/resolved" && e.RequestID != "" {
		if _, err = tx.Exec(`UPDATE workspace_chat_requests SET status='stale' WHERE session_id=? AND id=? AND status='pending'`, id, e.RequestID); err != nil {
			return err
		}
	}
	return tx.Commit()
}
func (s *Service) runNative(ctx context.Context, cancel context.CancelFunc, sess Session, m Message, turn agents.TurnRequest) {
	defer s.wg.Done()
	defer cancel()
	s.nativeFailures.Delete(sess.ID)
	prefix := uuid.NewString() + ":"
	onEvent := func(e agents.NativeEvent) {
		if e.RequestID != "" {
			e.RequestID = prefix + e.RequestID
		}
		if err := s.recordEvent(sess.ID, e); err != nil {
			s.nativeFailures.Store(sess.ID, err)
			go func() {
				s.mu.Lock()
				cancelActive := s.active[sess.ID]
				s.mu.Unlock()
				if cancelActive != nil {
					cancelActive()
				}
			}()
		}
	}
	s.mu.Lock()
	native := s.native[sess.ID]
	s.mu.Unlock()
	var err error
	if native == nil {
		if agents.Provider(sess.Provider) == agents.ProviderAntigravity {
			var baseline sql.NullInt64
			var persistedThread string
			if queryErr := s.db.QueryRowContext(ctx, `SELECT thread_id,cumulative_turn_count FROM workspace_chat_native WHERE session_id=?`, sess.ID).Scan(&persistedThread, &baseline); queryErr != nil {
				err = queryErr
			} else if persistedThread != "" && !baseline.Valid {
				err = errors.New("Antigravity conversation has no durable cumulative-turn baseline; resume is unknown")
			} else if persistedThread != "" && persistedThread != sess.ProviderThreadID {
				err = errors.New("Antigravity persisted conversation identity changed")
			} else if baseline.Valid {
				turn.ProviderTurnCounter = baseline.Int64
			}
		}
	}
	if native == nil && err == nil {
		native, err = s.registry.(nativeRegistry).StartNativeSession(context.Background(), agents.Provider(sess.Provider), turn, sess.ProviderThreadID, onEvent)
		if err == nil {
			info := native.ModelInfo()
			_, err = s.db.Exec(`UPDATE workspace_chat_native SET thread_id=?,effective_model=?,approval_policy=?,sandbox_mode=? WHERE session_id=?`, native.ThreadID(), info.Model, info.ApprovalPolicy, info.SandboxMode, sess.ID)
			if err == nil && info.AgentID != "" {
				_, err = s.db.Exec(`UPDATE workspace_chat_agent_selection SET effective_agent_id=?,observation='runtime_reported' WHERE session_id=?`, info.AgentID, sess.ID)
			}
			if err == nil {
				s.mu.Lock()
				if s.closed {
					err = fmt.Errorf("chat service shutting down")
				} else {
					s.native[sess.ID] = native
					s.nativePrefixes[sess.ID] = prefix
				}
				s.mu.Unlock()
				if err != nil {
					closeNative(native)
				}
			} else {
				closeNative(native)
			}
		}
	}
	// Each process callback belongs to its conversation, not its original turn.
	// Persistence failures cancel the active turn via the service's cancel map.
	var result agents.NativeTurnResult
	if err == nil {
		if options, ok := native.(agents.NativeTurnOptionsSession); ok {
			result, err = options.SendTurnWithOptions(ctx, turn.Prompt, agents.NativeTurnOptions{Model: turn.RequestedModel, ReasoningEffort: sess.RequestedReasoningEffort})
		} else if sess.RequestedReasoningEffort != "" {
			err = ErrUnsupported
		} else {
			result, err = native.SendTurn(ctx, turn.Prompt, turn.RequestedModel)
		}
	}
	_, persistFailed := s.nativeFailures.Load(sess.ID)
	status, msgStatus, errorText := "idle", "completed", ""
	if err != nil || result.Status == "failed" {
		status, msgStatus, errorText = "failed", "unknown", "Provider delivery failed or outcome is unknown. Inspect before sending again."
	}
	if result.Status == "interrupted" {
		status, msgStatus, errorText = "interrupted", "cancelled", "Turn interrupted; workspace files and provider thread retained."
	}
	if persistFailed {
		status, msgStatus, errorText = "interrupted", "unknown", "Chat event persistence failed; inspect provider thread before sending again."
	}
	if native != nil {
		info := native.ModelInfo()
		model := info.Model
		effort := info.ReasoningEffort
		if result.ReasoningEffort != "" {
			effort = result.ReasoningEffort
		}
		if result.Model != "" {
			model = result.Model
		}
		if _, e := s.db.Exec(`UPDATE workspace_chat_native SET effective_model=? WHERE session_id=?`, model, sess.ID); e != nil {
			status, msgStatus, errorText = "interrupted", "unknown", "Effective configuration persistence failed; inspect provider session."
		}
		if _, e := s.db.Exec(`UPDATE workspace_chat_efforts SET observed=? WHERE session_id=?`, effort, sess.ID); e != nil {
			status, msgStatus, errorText = "interrupted", "unknown", "Effective reasoning configuration persistence failed."
		}
		if agents.Provider(sess.Provider) == agents.ProviderAntigravity && result.CumulativeTurnCount > 0 {
			if _, e := s.db.Exec(`UPDATE workspace_chat_native SET cumulative_turn_count=? WHERE session_id=?`, result.CumulativeTurnCount, sess.ID); e != nil {
				status, msgStatus, errorText = "interrupted", "unknown", "Antigravity turn counter persistence failed; resume is unknown."
			}
		}
	}
	if err != nil && native != nil {
		closeNative(native)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	defer delete(s.active, sess.ID)
	if err != nil {
		delete(s.native, sess.ID)
		delete(s.nativePrefixes, sess.ID)
	}
	if e := s.finish(sess, m, result.Text, status, msgStatus, errorText); e != nil {
		_, _ = s.db.Exec(`UPDATE workspace_chat_messages SET status='unknown' WHERE id=?`, m.ID)
		_, _ = s.db.Exec(`UPDATE workspace_chat_sessions SET status='interrupted',error='Chat persistence failed; outcome unknown.' WHERE id=?`, sess.ID)
	}
	_, _ = s.db.Exec(`UPDATE workspace_chat_requests SET status='stale' WHERE session_id=? AND status='pending'`, sess.ID)
}
func (s *Service) Reply(ctx context.Context, pid, id, requestID string, req ReplyRequest) (RuntimeRequest, error) {
	if req.ClientResponseID == "" || len(req.ClientResponseID) > 200 || len(req.Answer) == 0 || len(req.Answer) > maxText || !json.Valid(req.Answer) {
		return RuntimeRequest{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.Detail(ctx, pid, id)
	if err != nil {
		return RuntimeRequest{}, err
	}
	var target *RuntimeRequest
	for i := range d.Requests {
		if d.Requests[i].ID == requestID {
			target = &d.Requests[i]
			break
		}
	}
	if target == nil {
		return RuntimeRequest{}, ErrNotFound
	}
	r := *target
	if r.ClientResponseID == req.ClientResponseID {
		if string(r.Answer) != string(req.Answer) {
			return RuntimeRequest{}, ErrInvalid
		}
		return r, nil
	}
	native := s.native[id]
	if r.Status != "pending" || native == nil || d.Session.Status != "running" {
		return RuntimeRequest{}, ErrBusy
	}
	if err = validateReply(r, req.Answer); err != nil {
		return RuntimeRequest{}, err
	}
	prefix := s.nativePrefixes[id]
	if prefix == "" || !strings.HasPrefix(requestID, prefix) {
		return RuntimeRequest{}, ErrBusy
	}
	if _, err = s.db.ExecContext(ctx, `UPDATE workspace_chat_requests SET status='sending',answer=?,client_response_id=? WHERE session_id=? AND id=?`, string(req.Answer), req.ClientResponseID, id, requestID); err != nil {
		return RuntimeRequest{}, err
	}
	// The durable sending receipt prevents concurrent re-dispatch. Do not hold
	// the project ownership mutex while writing to the provider process.
	s.mu.Unlock()
	err = native.RespondRequest(ctx, strings.TrimPrefix(requestID, prefix), req.Answer)
	s.mu.Lock()
	r.Answer = req.Answer
	r.ClientResponseID = req.ClientResponseID
	r.Status = "answered"
	if err != nil {
		r.Status = "unknown"
	}
	if _, e := s.db.Exec(`UPDATE workspace_chat_requests SET status=? WHERE session_id=? AND id=?`, r.Status, id, requestID); e != nil {
		return RuntimeRequest{}, e
	}
	// A failed write is a durable unknown receipt, never an invitation to retry.
	return r, nil
}
func validateReply(r RuntimeRequest, raw json.RawMessage) error {
	switch r.Method {
	case "item/commandExecution/requestApproval", "item/fileChange/requestApproval":
		var v struct {
			Decision string `json:"decision"`
		}
		if strictAnswer(raw, &v) != nil || (v.Decision != "accept" && v.Decision != "decline" && v.Decision != "cancel") {
			return ErrInvalid
		}
	case "item/tool/requestUserInput":
		var v struct {
			Answers map[string]struct {
				Answers []string `json:"answers"`
			} `json:"answers"`
		}
		if strictAnswer(raw, &v) != nil || len(v.Answers) == 0 {
			return ErrInvalid
		}
		var p struct {
			Questions []struct {
				ID string `json:"id"`
			} `json:"questions"`
		}
		if json.Unmarshal(r.Params, &p) != nil || len(p.Questions) == 0 || len(v.Answers) != len(p.Questions) {
			return ErrInvalid
		}
		for _, q := range p.Questions {
			a, ok := v.Answers[q.ID]
			if !ok || len(a.Answers) == 0 {
				return ErrInvalid
			}
			for _, answer := range a.Answers {
				if strings.TrimSpace(answer) == "" {
					return ErrInvalid
				}
			}
		}
	default:
		return ErrUnsupported
	}
	return nil
}
func strictAnswer(raw json.RawMessage, v any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		return ErrInvalid
	}
	return nil
}
