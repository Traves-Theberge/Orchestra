package orchestrator

import "strings"

func (s *Service) ReconcileRunningStates(activeStates []string, terminalStates []string, refreshed map[string]string) {
	active := normalizeStateSet(activeStates)
	terminal := normalizeStateSet(terminalStates)

	s.mu.Lock()
	defer s.mu.Unlock()

	filtered := make([]RunningEntry, 0, len(s.running))
	retained := make(map[string]struct{}, len(s.running))
	for _, entry := range s.running {
		state, ok := refreshed[entry.IssueID]
		if !ok {
			filtered = append(filtered, entry)
			retained[entry.IssueID] = struct{}{}
			continue
		}

		normalized := normalizeState(state)
		if _, isTerminal := terminal[normalized]; isTerminal {
			s.accumulateEntryTotalsLocked(entry)
			continue
		}
		if _, isActive := active[normalized]; !isActive {
			s.accumulateEntryTotalsLocked(entry)
			continue
		}

		entry.State = state
		filtered = append(filtered, entry)
		retained[entry.IssueID] = struct{}{}
	}

	s.running = filtered
	for issueID := range s.claimed {
		if _, ok := retained[issueID]; !ok {
			delete(s.claimed, issueID)
		}
	}
}

func normalizeStateSet(states []string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, state := range states {
		normalized := normalizeState(state)
		if normalized == "" {
			continue
		}
		out[normalized] = struct{}{}
	}
	return out
}

func normalizeState(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
