package workspacechat

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/orchestra/orchestra/apps/backend/internal/db"
)

// Branch is one version of a conversation. The main branch has no row: its id
// is the session id, and messages/events with an empty branch_id belong to it.
type Branch struct {
	ID               string `json:"id"`
	SessionID        string `json:"session_id"`
	ParentID         string `json:"parent_id"`
	ForkAfterOrdinal int64  `json:"fork_after_ordinal"`
	ForkAfterTime    string `json:"fork_after_time"`
	CreatedAt        string `json:"created_at"`
}

// Checkpoint records a file snapshot taken around a user message: kind is
// before, after or safety.
type Checkpoint struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	BranchID  string `json:"branch_id"`
	MessageID string `json:"message_id"`
	Kind      string `json:"kind"`
	TreeHash  string `json:"tree_hash"`
	CreatedAt string `json:"created_at"`
	Files     int    `json:"files"`
	Bytes     int64  `json:"bytes"`
	Skipped   int    `json:"skipped"`
}

// VersionRef lists one sibling version at a fork point: the branch owning the
// forked-after message first, then the branches forked there in creation
// order. Active marks the version whose messages continue past the fork point
// in the current view (an ancestor of the viewed branch can be that version).
type VersionRef struct {
	BranchID string `json:"branch_id"`
	Active   bool   `json:"active"`
}

// chainLink bounds what one branch contributes to a view: its messages up to
// MaxOrdinal and, when Bounded (every ancestor), its events up to MaxTime. An
// ancestor with an empty MaxTime contributes no events.
type chainLink struct {
	BranchID   string
	MaxOrdinal int64
	MaxTime    string
	Bounded    bool
}

// effectiveBranch maps a stored branch_id to its branch (empty is main).
const effectiveBranch = `COALESCE(NULLIF(m.branch_id,''),m.session_id)`

func migrateBranches(d *db.DB) error {
	if _, err := d.Exec(`CREATE TABLE IF NOT EXISTS workspace_chat_branches(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, parent_id TEXT NOT NULL, fork_after_ordinal INTEGER NOT NULL, fork_after_time TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workspace_chat_branch_session ON workspace_chat_branches(session_id);
	 CREATE TABLE IF NOT EXISTS workspace_chat_active_branch(session_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL);
	 CREATE TABLE IF NOT EXISTS workspace_chat_checkpoints(id TEXT PRIMARY KEY, session_id TEXT NOT NULL, branch_id TEXT NOT NULL, message_id TEXT NOT NULL, kind TEXT NOT NULL, tree_hash TEXT NOT NULL, files INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS workspace_chat_checkpoint_message ON workspace_chat_checkpoints(session_id,message_id,kind);
	 CREATE TABLE IF NOT EXISTS workspace_chat_branch_seed(session_id TEXT PRIMARY KEY, created_at TEXT NOT NULL);`); err != nil {
		return err
	}
	// Existing rows keep branch_id '' and so stay on the main branch.
	for _, table := range []string{"workspace_chat_messages", "workspace_chat_events", "workspace_chat_requests"} {
		if _, err := d.Exec(`ALTER TABLE ` + table + ` ADD COLUMN branch_id TEXT NOT NULL DEFAULT ''`); err != nil && !strings.Contains(err.Error(), "duplicate column") {
			return err
		}
	}
	return nil
}

// rowQuerier is satisfied by both the database and a transaction.
type rowQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func activeBranchIn(ctx context.Context, q rowQuerier, sessionID string) (string, error) {
	var id string
	err := q.QueryRowContext(ctx, `SELECT branch_id FROM workspace_chat_active_branch WHERE session_id=?`, sessionID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) || err == nil && id == "" {
		return sessionID, nil
	}
	return id, err
}

func (s *Service) activeBranchID(ctx context.Context, sessionID string) (string, error) {
	return activeBranchIn(ctx, s.db, sessionID)
}

// writeBranchIn is the branch new rows join: the active branch, or main when
// the active pointer dangles, matching what visibleChain shows.
func writeBranchIn(ctx context.Context, q rowQuerier, sessionID string) (string, error) {
	active, err := activeBranchIn(ctx, q, sessionID)
	if err != nil || active == sessionID {
		return active, err
	}
	var found int
	err = q.QueryRowContext(ctx, `SELECT 1 FROM workspace_chat_branches WHERE session_id=? AND id=?`, sessionID, active).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return sessionID, nil
	}
	return active, err
}

// storedBranch is the branch_id column value for a branch: empty for main, so
// rows written before branches existed and rows written since look the same.
func storedBranch(sessionID, branchID string) string {
	if branchID == sessionID {
		return ""
	}
	return branchID
}

// branchChain walks from a branch to main, newest first. Each ancestor is
// bounded by the tightest fork point below it, so a fork inside inherited
// history never exposes an intermediate branch's own messages.
func (s *Service) branchChain(ctx context.Context, sessionID, branchID string) ([]chainLink, error) {
	chain := []chainLink{{BranchID: branchID, MaxOrdinal: math.MaxInt64}}
	seen := map[string]bool{branchID: true}
	for id := branchID; id != sessionID; {
		var parent, forkTime string
		var forkOrdinal int64
		err := s.db.QueryRowContext(ctx, `SELECT parent_id,fork_after_ordinal,fork_after_time FROM workspace_chat_branches WHERE session_id=? AND id=?`, sessionID, id).Scan(&parent, &forkOrdinal, &forkTime)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		if seen[parent] {
			return nil, fmt.Errorf("conversation branch %s has a cyclic parent", id)
		}
		seen[parent] = true
		child := chain[len(chain)-1]
		chain = append(chain, chainLink{BranchID: parent, MaxOrdinal: min(forkOrdinal, child.MaxOrdinal), MaxTime: ancestorTime(forkTime, child), Bounded: true})
		id = parent
	}
	return chain, nil
}

// visibleChain is the active branch's chain. A dangling active pointer falls
// back to main rather than making the conversation unreadable.
func (s *Service) visibleChain(ctx context.Context, sessionID string) ([]chainLink, error) {
	active, err := s.activeBranchID(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	chain, err := s.branchChain(ctx, sessionID, active)
	if errors.Is(err, ErrNotFound) {
		return s.branchChain(ctx, sessionID, sessionID)
	}
	return chain, err
}

// chainPredicate selects the messages (alias m) visible along a chain.
func chainPredicate(chain []chainLink) (string, []any) {
	clauses := make([]string, 0, len(chain))
	args := make([]any, 0, 2*len(chain))
	for _, link := range chain {
		clauses = append(clauses, `(`+effectiveBranch+`=? AND m.ordinal<=?)`)
		args = append(args, link.BranchID, link.MaxOrdinal)
	}
	return `(` + strings.Join(clauses, ` OR `) + `)`, args
}

// eventVisible applies the chain to an event or runtime request. Ancestors are
// bounded by time because the UI buckets events to messages by timestamp.
func eventVisible(chain []chainLink, branchID, createdAt string) bool {
	for _, link := range chain {
		if link.BranchID == branchID {
			return !link.Bounded || link.MaxTime != "" && timeNotAfter(createdAt, link.MaxTime)
		}
	}
	return false
}

// timeNotAfter compares stamps by instant: RFC3339Nano trims trailing zeros,
// so its strings do not sort lexically.
func timeNotAfter(at, bound string) bool {
	a, errA := time.Parse(time.RFC3339Nano, at)
	b, errB := time.Parse(time.RFC3339Nano, bound)
	if errA != nil || errB != nil {
		return at <= bound
	}
	return !a.After(b)
}

// ancestorTime is the event bound of a parent link: the tighter of its fork
// time and the bound of the link below it. Empty means the beginning of time
// (a fork before the first message), except below an unbounded head.
func ancestorTime(forkTime string, child chainLink) string {
	if !child.Bounded {
		return forkTime
	}
	if forkTime == "" || child.MaxTime == "" {
		return ""
	}
	if timeNotAfter(forkTime, child.MaxTime) {
		return forkTime
	}
	return child.MaxTime
}

// createBranch records a fork. The fork point is attached to the branch that
// owns the forked-after message, so editing an inherited message from a
// branch makes a sibling of that branch rather than a child of it, and every
// view lists the same versions.
func (s *Service) createBranch(ctx context.Context, tx *sql.Tx, sessionID, parentID string, forkAfterOrdinal int64, forkAfterTime string) (Branch, error) {
	if forkAfterOrdinal < 0 || forkAfterOrdinal > 0 && forkAfterTime == "" {
		return Branch{}, ErrInvalid
	}
	seen := map[string]bool{}
	for parentID != sessionID && !seen[parentID] {
		seen[parentID] = true
		var grandparent string
		var parentFork int64
		err := tx.QueryRowContext(ctx, `SELECT parent_id,fork_after_ordinal FROM workspace_chat_branches WHERE session_id=? AND id=?`, sessionID, parentID).Scan(&grandparent, &parentFork)
		if errors.Is(err, sql.ErrNoRows) {
			return Branch{}, ErrInvalid
		}
		if err != nil {
			return Branch{}, err
		}
		if forkAfterOrdinal > parentFork {
			break
		}
		parentID = grandparent
	}
	b := Branch{ID: uuid.NewString(), SessionID: sessionID, ParentID: parentID, ForkAfterOrdinal: forkAfterOrdinal, ForkAfterTime: forkAfterTime, CreatedAt: stamp()}
	if _, err := tx.ExecContext(ctx, `INSERT INTO workspace_chat_branches(id,session_id,parent_id,fork_after_ordinal,fork_after_time,created_at) VALUES(?,?,?,?,?,?)`, b.ID, b.SessionID, b.ParentID, b.ForkAfterOrdinal, b.ForkAfterTime, b.CreatedAt); err != nil {
		return Branch{}, err
	}
	return b, nil
}

func (s *Service) saveCheckpoint(ctx context.Context, c Checkpoint) error {
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	if c.CreatedAt == "" {
		c.CreatedAt = stamp()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO workspace_chat_checkpoints(id,session_id,branch_id,message_id,kind,tree_hash,files,bytes,skipped,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, c.ID, c.SessionID, c.BranchID, c.MessageID, c.Kind, c.TreeHash, c.Files, c.Bytes, c.Skipped, c.CreatedAt)
	return err
}

// checkpointFor returns the newest checkpoint of a kind for a message.
func (s *Service) checkpointFor(ctx context.Context, sessionID, messageID, kind string) (Checkpoint, bool, error) {
	var c Checkpoint
	err := s.db.QueryRowContext(ctx, `SELECT id,session_id,branch_id,message_id,kind,tree_hash,files,bytes,skipped,created_at FROM workspace_chat_checkpoints WHERE session_id=? AND message_id=? AND kind=? ORDER BY rowid DESC LIMIT 1`, sessionID, messageID, kind).Scan(&c.ID, &c.SessionID, &c.BranchID, &c.MessageID, &c.Kind, &c.TreeHash, &c.Files, &c.Bytes, &c.Skipped, &c.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Checkpoint{}, false, nil
	}
	if err != nil {
		return Checkpoint{}, false, err
	}
	return c, true, nil
}

// decorateBranches flags messages with a before-checkpoint and lists sibling
// versions on the first visible message after each fork point. ordinals runs
// parallel to messages.
func (s *Service) decorateBranches(ctx context.Context, sessionID string, chain []chainLink, messages []Message, ordinals []int64) error {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT message_id FROM workspace_chat_checkpoints WHERE session_id=? AND kind='before'`, sessionID)
	if err != nil {
		return err
	}
	checkpointed := map[string]bool{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		checkpointed[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for i := range messages {
		messages[i].HasCheckpoint = checkpointed[messages[i].ID]
	}
	type forkPoint struct {
		parent  string
		ordinal int64
	}
	rows, err = s.db.QueryContext(ctx, `SELECT id,parent_id,fork_after_ordinal FROM workspace_chat_branches WHERE session_id=? ORDER BY created_at,rowid`, sessionID)
	if err != nil {
		return err
	}
	var ids []string
	forks := map[string]forkPoint{}
	for rows.Next() {
		var id string
		var p forkPoint
		if err = rows.Scan(&id, &p.parent, &p.ordinal); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
		forks[id] = p
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Group by the fork point's owner (as createBranch stores it), so rows
	// written with a literal parent still list consistent versions.
	var points []forkPoint
	children := map[forkPoint][]string{}
	for _, id := range ids {
		p := forks[id]
		for steps := 0; p.parent != sessionID && steps < len(ids); steps++ {
			parent, ok := forks[p.parent]
			if !ok || p.ordinal > parent.ordinal {
				break
			}
			p.parent = parent.parent
		}
		if _, ok := children[p]; !ok {
			points = append(points, p)
		}
		children[p] = append(children[p], id)
	}
	bound := map[string]int64{}
	for _, link := range chain {
		bound[link.BranchID] = link.MaxOrdinal
	}
	for _, p := range points {
		// The shown side is the version on the chain whose messages follow the
		// fork point: a forked branch on the chain, else the owner itself.
		active := ""
		for _, id := range children[p] {
			if _, ok := bound[id]; ok {
				active = id
			}
		}
		if _, ok := bound[p.parent]; active == "" && ok {
			active = p.parent
		}
		// The view must continue past the fork point on the shown side.
		if active == "" || bound[active] <= p.ordinal {
			continue
		}
		for i, ordinal := range ordinals {
			if ordinal <= p.ordinal {
				continue
			}
			if messages[i].Versions == nil {
				versions := []VersionRef{{BranchID: p.parent, Active: active == p.parent}}
				for _, id := range children[p] {
					versions = append(versions, VersionRef{BranchID: id, Active: active == id})
				}
				messages[i].Versions = versions
			}
			break
		}
	}
	return nil
}
