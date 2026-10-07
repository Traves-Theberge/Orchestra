package automations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
)

// Start runs a catch-up evaluation immediately and then evaluates schedules
// on every tick until Close.
func (s *Service) Start() {
	s.mu.Lock()
	if s.startedLoop || s.closing {
		s.mu.Unlock()
		return
	}
	s.startedLoop = true
	s.loop.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.loop.Done()
		s.Tick(s.now())
		ticker := time.NewTicker(s.opts.TickInterval)
		defer ticker.Stop()
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-ticker.C:
				s.Tick(s.now())
			}
		}
	}()
}

// lateTolerance is how late a due run may start when grace is 0 ("no
// grace"): a normal tick delay is never treated as a missed run.
func (s *Service) lateTolerance(graceMinutes int) time.Duration {
	if graceMinutes > 0 {
		return time.Duration(graceMinutes) * time.Minute
	}
	return 2 * s.opts.TickInterval
}

// Tick evaluates every enabled automation once. Overlapping calls are
// dropped, never queued.
func (s *Service) Tick(now time.Time) {
	if !s.tickMu.TryLock() {
		return
	}
	defer s.tickMu.Unlock()
	if s.isClosing() {
		return
	}
	ctx := context.Background()
	list, err := s.store.List(ctx)
	if err != nil {
		log.Printf("automations: list for tick: %v", err)
		return
	}
	for _, a := range list {
		if !a.Enabled || a.NextRunAt == "" {
			continue
		}
		next := parseStamp(a.NextRunAt)
		if next.IsZero() || next.After(now) {
			continue
		}
		c, err := Compile(a.Schedule)
		if err != nil {
			_ = s.store.SetNextRun(ctx, a.ID, "")
			continue
		}
		due := c.LatestDue(next, now)
		if err := s.store.SetNextRun(ctx, a.ID, stampTime(c.Next(now))); err != nil {
			log.Printf("automations: advance %s: %v", a.ID, err)
			continue
		}
		scheduledFor := stampTime(due)
		if now.Sub(due) > s.lateTolerance(a.GraceMinutes) {
			reason := "Missed: the backend was not running when this run was due, and it is past the grace window."
			if a.GraceMinutes == 0 {
				reason = "Missed: the backend was not running when this run was due (no grace window)."
			}
			s.recordSkip(a, StatusSkippedMissed, reason, scheduledFor, PrecheckResult{})
			continue
		}
		s.dispatchScheduled(a, scheduledFor)
	}
}

func (s *Service) recordSkip(a Automation, status, reason, scheduledFor string, pre PrecheckResult) {
	now := stampTime(s.now())
	r := Run{ID: uuid.NewString(), AutomationID: a.ID, AutomationName: a.Name, Trigger: TriggerScheduled, Status: status, ScheduledFor: scheduledFor, FinishedAt: now, ProjectID: a.ProjectID, TaskID: a.TaskID, Provider: a.Provider, Model: a.Model, Error: reason, Precheck: pre, CreatedAt: now, UpdatedAt: now}
	saved, err := s.store.RecordSkip(context.Background(), r)
	if err != nil {
		log.Printf("automations: record %s for %s: %v", status, a.ID, err)
		return
	}
	_ = s.store.Prune(context.Background(), a.ID, RunRetention)
	s.publish(saved)
}

// precheckDir resolves where a scheduled precheck runs.
func (s *Service) precheckDir(ctx context.Context, a Automation) (string, error) {
	if a.ProjectID == "" {
		if s.opts.MaestroRoot == "" {
			return "", errors.New("Maestro workspace is unavailable")
		}
		return s.opts.MaestroRoot, nil
	}
	p, err := s.db.GetProjectByID(ctx, a.ProjectID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", errors.New("linked project no longer exists")
		}
		return "", err
	}
	return p.RootPath, nil
}

func (s *Service) dispatchScheduled(a Automation, scheduledFor string) {
	s.mu.Lock()
	if s.busyLocked(a.ID) {
		s.mu.Unlock()
		s.recordSkip(a, StatusSkippedBusy, "Skipped: the previous run of this automation is still active.", scheduledFor, PrecheckResult{})
		return
	}
	s.pending[a.ID] = true
	s.dispatches.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.dispatches.Done()
		release := func() {
			s.mu.Lock()
			delete(s.pending, a.ID)
			s.mu.Unlock()
		}
		if a.Precheck.Command != "" {
			dir, err := s.precheckDir(context.Background(), a)
			if err != nil {
				release()
				s.recordSkip(a, StatusSkippedUnavailable, "Unavailable: "+err.Error(), scheduledFor, PrecheckResult{})
				return
			}
			res := s.opts.Precheck(s.ctx, dir, a.Precheck.Command, time.Duration(a.Precheck.TimeoutSeconds)*time.Second)
			if s.isClosing() {
				release()
				return
			}
			if res.ExitCode != 0 {
				release()
				reason := fmt.Sprintf("Precheck exited with code %d; run skipped.", res.ExitCode)
				if res.ExitCode == -1 {
					reason = "Precheck did not complete (timed out or could not start); run skipped."
				}
				s.recordSkip(a, StatusSkippedPrecheck, reason, scheduledFor, res)
				return
			}
			if _, _, err := s.startReserved(a, TriggerScheduled, scheduledFor, true, res); err != nil && !errors.Is(err, ErrUnavailable) {
				log.Printf("automations: start %s: %v", a.ID, err)
			}
			return
		}
		if _, _, err := s.startReserved(a, TriggerScheduled, scheduledFor, true, PrecheckResult{}); err != nil && !errors.Is(err, ErrUnavailable) {
			log.Printf("automations: start %s: %v", a.ID, err)
		}
	}()
}
