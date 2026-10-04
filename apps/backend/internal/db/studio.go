package db

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

type StudioSession struct {
	ID        string
	ProjectID string
	Runner    string
	StartedAt time.Time
	EndedAt   *time.Time
	Outcome   string
}

type IssueDraft struct {
	ID                 string
	SessionID          string
	Title              string
	Description        string
	AcceptanceCriteria string // JSON array
	Attachments        string // JSON array
	SuggestedProvider  string
	SuggestedModel     string
	MaxTurns           *int
	TemplateName       string
	TemplateVars       string // JSON object
	AgentGuidance      string // JSON object
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

var draftAllowedColumns = map[string]bool{
	"title":               true,
	"description":         true,
	"acceptance_criteria": true,
	"attachments":         true,
	"suggested_provider":  true,
	"suggested_model":     true,
	"max_turns":           true,
	"template_name":       true,
	"template_vars":       true,
	"agent_guidance":      true,
}

func CreateStudioSession(d *sql.DB, s StudioSession) error {
	_, err := d.Exec(
		`INSERT INTO studio_sessions (id, project_id, runner) VALUES (?, ?, ?)`,
		s.ID, s.ProjectID, s.Runner,
	)
	return err
}

func GetStudioSession(d *sql.DB, id string) (StudioSession, error) {
	row := d.QueryRow(`SELECT id, project_id, runner, started_at, ended_at, COALESCE(outcome,'') FROM studio_sessions WHERE id=?`, id)
	var s StudioSession
	var ended sql.NullTime
	if err := row.Scan(&s.ID, &s.ProjectID, &s.Runner, &s.StartedAt, &ended, &s.Outcome); err != nil {
		return StudioSession{}, err
	}
	if ended.Valid {
		s.EndedAt = &ended.Time
	}
	return s, nil
}

func EndStudioSession(d *sql.DB, id, outcome string) error {
	_, err := d.Exec(
		`UPDATE studio_sessions SET ended_at=CURRENT_TIMESTAMP, outcome=? WHERE id=?`,
		outcome, id,
	)
	return err
}

func CreateDraft(d *sql.DB, sessionID string) error {
	_, err := d.Exec(
		`INSERT INTO issue_drafts (id, session_id) VALUES (?, ?)`,
		"draft-"+sessionID, sessionID,
	)
	return err
}

func GetDraft(d *sql.DB, sessionID string) (IssueDraft, error) {
	row := d.QueryRow(`
		SELECT id, session_id, title, description, acceptance_criteria, attachments,
		       COALESCE(suggested_provider,''), COALESCE(suggested_model,''), max_turns,
		       COALESCE(template_name,''), template_vars, agent_guidance,
		       created_at, updated_at
		FROM issue_drafts WHERE session_id=?`, sessionID)
	var d2 IssueDraft
	var maxTurns sql.NullInt64
	if err := row.Scan(
		&d2.ID, &d2.SessionID, &d2.Title, &d2.Description, &d2.AcceptanceCriteria, &d2.Attachments,
		&d2.SuggestedProvider, &d2.SuggestedModel, &maxTurns,
		&d2.TemplateName, &d2.TemplateVars, &d2.AgentGuidance,
		&d2.CreatedAt, &d2.UpdatedAt,
	); err != nil {
		return IssueDraft{}, err
	}
	if maxTurns.Valid {
		v := int(maxTurns.Int64)
		d2.MaxTurns = &v
	}
	return d2, nil
}

func UpdateDraftField(d *sql.DB, sessionID, column string, value interface{}) error {
	if !draftAllowedColumns[column] {
		return fmt.Errorf("studio: column not allowed: %q", column)
	}
	q := fmt.Sprintf("UPDATE issue_drafts SET %s=?, updated_at=CURRENT_TIMESTAMP WHERE session_id=?", column)
	_, err := d.Exec(q, value, sessionID)
	return err
}

// UpdateDraftFields applies a fully validated patch in one atomic SQL statement.
func UpdateDraftFields(d *sql.DB, sessionID string, fields map[string]any) error {
	columns := make([]string, 0, len(fields))
	for column := range fields {
		if !draftAllowedColumns[column] {
			return fmt.Errorf("studio: column not allowed: %q", column)
		}
		columns = append(columns, column)
	}
	if len(columns) == 0 {
		_, err := GetDraft(d, sessionID)
		return err
	}
	sort.Strings(columns)
	assignments := make([]string, 0, len(columns)+1)
	values := make([]any, 0, len(columns)+1)
	for _, column := range columns {
		assignments = append(assignments, column+"=?")
		values = append(values, fields[column])
	}
	assignments = append(assignments, "updated_at=CURRENT_TIMESTAMP")
	values = append(values, sessionID)
	result, err := d.Exec("UPDATE issue_drafts SET "+strings.Join(assignments, ",")+" WHERE session_id=?", values...)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err == nil && count == 0 {
		return sql.ErrNoRows
	}
	return err
}

func DeleteDraft(d *sql.DB, sessionID string) error {
	_, err := d.Exec(`DELETE FROM issue_drafts WHERE session_id=?`, sessionID)
	return err
}
