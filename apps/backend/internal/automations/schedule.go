package automations

import (
	"fmt"
	"math/bits"
	"strconv"
	"strings"
	"time"
)

// Schedule is the API representation of an automation cadence. Presets
// compile to a 5-field cron expression evaluated in Timezone.
type Schedule struct {
	Kind     string `json:"kind"`
	Time     string `json:"time,omitempty"`
	Minute   int    `json:"minute"`
	Day      int    `json:"day"`
	Cron     string `json:"cron,omitempty"`
	Timezone string `json:"timezone,omitempty"`
}

var weekdayNames = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

// CompiledSchedule is a validated schedule ready for occurrence math.
type CompiledSchedule struct {
	Expr     string
	Location *time.Location
	spec     cronSpec
	source   Schedule
}

type cronSpec struct {
	minute, hour, dom, month, dow uint64
	domStar, dowStar              bool
}

func parseHHMM(v string) (int, int, error) {
	parts := strings.Split(strings.TrimSpace(v), ":")
	if len(parts) != 2 || len(parts[0]) < 1 || len(parts[0]) > 2 || len(parts[1]) != 2 {
		return 0, 0, fmt.Errorf("time must be HH:MM")
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("time must be HH:MM (00:00-23:59)")
	}
	return h, m, nil
}

// LoadLocation resolves an IANA zone; empty means the backend local zone.
func LoadLocation(name string) (*time.Location, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return time.Local, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil || strings.EqualFold(name, "local") {
		return nil, fmt.Errorf("unknown timezone %q", name)
	}
	return loc, nil
}

// Compile validates a schedule and compiles its preset to cron.
func Compile(s Schedule) (CompiledSchedule, error) {
	loc, err := LoadLocation(s.Timezone)
	if err != nil {
		return CompiledSchedule{}, err
	}
	var expr string
	switch s.Kind {
	case "hourly":
		if s.Minute < 0 || s.Minute > 59 {
			return CompiledSchedule{}, fmt.Errorf("minute must be 0-59")
		}
		expr = fmt.Sprintf("%d * * * *", s.Minute)
	case "daily", "weekdays", "weekly":
		h, m, err := parseHHMM(s.Time)
		if err != nil {
			return CompiledSchedule{}, err
		}
		dow := "*"
		if s.Kind == "weekdays" {
			dow = "1-5"
		}
		if s.Kind == "weekly" {
			if s.Day < 0 || s.Day > 6 {
				return CompiledSchedule{}, fmt.Errorf("day must be 0-6 (Sunday=0)")
			}
			dow = strconv.Itoa(s.Day)
		}
		expr = fmt.Sprintf("%d %d * * %s", m, h, dow)
	case "cron":
		expr = strings.Join(strings.Fields(s.Cron), " ")
	default:
		return CompiledSchedule{}, fmt.Errorf("kind must be hourly, daily, weekdays, weekly or cron")
	}
	spec, err := parseCron(expr)
	if err != nil {
		return CompiledSchedule{}, err
	}
	return CompiledSchedule{Expr: expr, Location: loc, spec: spec, source: s}, nil
}

// Description is a short human label, e.g. "Weekdays at 09:00 (America/Edmonton)".
func (c CompiledSchedule) Description() string {
	s := c.source
	var base string
	switch s.Kind {
	case "hourly":
		base = fmt.Sprintf("Hourly at :%02d", s.Minute)
	case "daily":
		base = "Daily at " + normalizeHHMM(s.Time)
	case "weekdays":
		base = "Weekdays at " + normalizeHHMM(s.Time)
	case "weekly":
		base = fmt.Sprintf("Weekly on %s at %s", weekdayNames[s.Day], normalizeHHMM(s.Time))
	default:
		base = "Cron " + c.Expr
	}
	zone := strings.TrimSpace(s.Timezone)
	if zone == "" {
		zone = "local time"
	}
	return base + " (" + zone + ")"
}

func normalizeHHMM(v string) string {
	h, m, err := parseHHMM(v)
	if err != nil {
		return v
	}
	return fmt.Sprintf("%02d:%02d", h, m)
}

var monthNames = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
var dowNames = map[string]int{"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}

func parseCron(expr string) (cronSpec, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return cronSpec{}, fmt.Errorf("cron must have 5 fields: minute hour day-of-month month day-of-week")
	}
	var spec cronSpec
	var err error
	if spec.minute, err = parseField(fields[0], 0, 59, nil, "minute"); err != nil {
		return spec, err
	}
	if spec.hour, err = parseField(fields[1], 0, 23, nil, "hour"); err != nil {
		return spec, err
	}
	if spec.dom, err = parseField(fields[2], 1, 31, nil, "day-of-month"); err != nil {
		return spec, err
	}
	if spec.month, err = parseField(fields[3], 1, 12, monthNames, "month"); err != nil {
		return spec, err
	}
	if spec.dow, err = parseField(fields[4], 0, 7, dowNames, "day-of-week"); err != nil {
		return spec, err
	}
	if spec.dow&(1<<7) != 0 { // 7 is Sunday
		spec.dow = (spec.dow | 1) &^ (1 << 7)
	}
	spec.domStar = strings.HasPrefix(fields[2], "*")
	spec.dowStar = strings.HasPrefix(fields[4], "*")
	return spec, nil
}

func parseValue(v string, names map[string]int, label string) (int, error) {
	if names != nil {
		if n, ok := names[strings.ToLower(v)]; ok {
			return n, nil
		}
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s value %q", label, v)
	}
	return n, nil
}

func parseField(field string, min, max int, names map[string]int, label string) (uint64, error) {
	if field == "" {
		return 0, fmt.Errorf("empty %s field", label)
	}
	var set uint64
	for _, part := range strings.Split(field, ",") {
		if part == "" {
			return 0, fmt.Errorf("empty list item in %s field", label)
		}
		rangePart, step := part, 1
		if i := strings.Index(part, "/"); i >= 0 {
			rangePart = part[:i]
			n, err := strconv.Atoi(part[i+1:])
			if err != nil || n <= 0 {
				return 0, fmt.Errorf("invalid step in %s field %q", label, part)
			}
			step = n
		}
		lo, hi := min, max
		switch {
		case rangePart == "*":
		case strings.Contains(rangePart, "-"):
			bounds := strings.SplitN(rangePart, "-", 2)
			a, err := parseValue(bounds[0], names, label)
			if err != nil {
				return 0, err
			}
			b, err := parseValue(bounds[1], names, label)
			if err != nil {
				return 0, err
			}
			lo, hi = a, b
		default:
			a, err := parseValue(rangePart, names, label)
			if err != nil {
				return 0, err
			}
			lo = a
			if step == 1 {
				hi = a
			}
		}
		if lo < min || hi > max || lo > hi {
			return 0, fmt.Errorf("%s field %q out of range %d-%d", label, part, min, max)
		}
		for v := lo; v <= hi; v += step {
			set |= 1 << uint(v)
		}
	}
	return set, nil
}

func listBits(set uint64) []int {
	out := make([]int, 0, bits.OnesCount64(set))
	for v := 0; v < 64; v++ {
		if set&(1<<uint(v)) != 0 {
			out = append(out, v)
		}
	}
	return out
}

func (s cronSpec) dayMatches(t time.Time) bool {
	dom := s.dom&(1<<uint(t.Day())) != 0
	dow := s.dow&(1<<uint(t.Weekday())) != 0
	if s.domStar || s.dowStar {
		return dom && dow
	}
	return dom || dow
}

// Next returns the first occurrence strictly after `after`, or the zero time
// when none exists within five years (e.g. "0 0 31 2 *").
//
// DST: wall times that do not exist (spring forward) fire at the first instant
// after the gap when the hour field is restricted; with a wildcard hour they
// are skipped (the following hour already fires). Repeated wall times (fall
// back) fire once.
func (c CompiledSchedule) Next(after time.Time) time.Time {
	loc := c.Location
	if loc == nil {
		loc = time.Local
	}
	a := after.In(loc)
	hours := listBits(c.spec.hour)
	minutes := listBits(c.spec.minute)
	hourStar := c.spec.hour == (1<<24)-1
	day := time.Date(a.Year(), a.Month(), a.Day(), 12, 0, 0, 0, loc)
	for i := 0; i < 366*5+2; i++ {
		y, mo, d := day.Date()
		if c.spec.month&(1<<uint(mo)) != 0 && c.spec.dayMatches(day) {
			for _, h := range hours {
				// Wall hours only repeat by one at a fall-back transition, so
				// hours well before `after` on its own day cannot qualify.
				if i == 0 && h < a.Hour()-2 {
					continue
				}
				for _, m := range minutes {
					cand := time.Date(y, mo, d, h, m, 0, 0, loc)
					if cand.Hour() != h || cand.Minute() != m || cand.Day() != d {
						// Nonexistent wall time inside a DST gap.
						if hourStar {
							continue
						}
						cand = firstInstantAfterGap(y, mo, d, h, loc)
					}
					if cand.After(after) {
						return cand
					}
				}
			}
		}
		day = time.Date(y, mo, d+1, 12, 0, 0, 0, loc)
	}
	return time.Time{}
}

// firstInstantAfterGap finds the first valid wall time at or after h:00 on
// the given day by probing forward minute by minute (gaps are < 2h).
func firstInstantAfterGap(y int, mo time.Month, d, h int, loc *time.Location) time.Time {
	for offset := 0; offset <= 180; offset++ {
		hh, mm := h+(offset/60), offset%60
		t := time.Date(y, mo, d, hh, mm, 0, 0, loc)
		if t.Hour() == hh%24 && t.Minute() == mm && t.Day() == d {
			return t
		}
	}
	return time.Date(y, mo, d, h+1, 0, 0, 0, loc)
}

// NextN returns up to n occurrences after `after`.
func (c CompiledSchedule) NextN(after time.Time, n int) []time.Time {
	out := []time.Time{}
	t := after
	for len(out) < n {
		t = c.Next(t)
		if t.IsZero() {
			break
		}
		out = append(out, t)
	}
	return out
}

// LatestDue returns the most recent occurrence in [from, now], where `from`
// is a known due occurrence (the stored next_run_at). It walks a growing
// window ending at now, so long downtimes cost a bounded number of steps.
// It returns the zero time when from is after now.
func (c CompiledSchedule) LatestDue(from, now time.Time) time.Time {
	if from.After(now) {
		return time.Time{}
	}
	for _, w := range []time.Duration{time.Hour, 25 * time.Hour, 8 * 24 * time.Hour, 32 * 24 * time.Hour, 367 * 24 * time.Hour, 5 * 367 * 24 * time.Hour} {
		start := now.Add(-w)
		covered := false
		if !start.After(from) {
			start, covered = from.Add(-time.Nanosecond), true
		}
		var latest time.Time
		for t := start; ; {
			n := c.Next(t)
			if n.IsZero() || n.After(now) {
				break
			}
			latest, t = n, n
		}
		if !latest.IsZero() {
			return latest
		}
		if covered {
			break
		}
	}
	return from
}
