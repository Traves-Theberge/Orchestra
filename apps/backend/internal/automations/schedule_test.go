package automations

import (
	"testing"
	"time"
)

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Skipf("zone %s unavailable: %v", name, err)
	}
	return loc
}

func TestCompilePresets(t *testing.T) {
	cases := []struct {
		in   Schedule
		expr string
		desc string
	}{
		{Schedule{Kind: "hourly", Minute: 15, Timezone: "UTC"}, "15 * * * *", "Hourly at :15 (UTC)"},
		{Schedule{Kind: "daily", Time: "16:30", Timezone: "UTC"}, "30 16 * * *", "Daily at 16:30 (UTC)"},
		{Schedule{Kind: "weekdays", Time: "9:00", Timezone: "America/Edmonton"}, "0 9 * * 1-5", "Weekdays at 09:00 (America/Edmonton)"},
		{Schedule{Kind: "weekly", Time: "14:00", Day: 4, Timezone: "UTC"}, "0 14 * * 4", "Weekly on Thursday at 14:00 (UTC)"},
		{Schedule{Kind: "cron", Cron: " */5  1-3 * * * ", Timezone: "UTC"}, "*/5 1-3 * * *", "Cron */5 1-3 * * * (UTC)"},
		{Schedule{Kind: "daily", Time: "08:05"}, "5 8 * * *", "Daily at 08:05 (local time)"},
	}
	for _, c := range cases {
		got, err := Compile(c.in)
		if err != nil {
			t.Fatalf("%+v: %v", c.in, err)
		}
		if got.Expr != c.expr || got.Description() != c.desc {
			t.Fatalf("%+v: expr %q desc %q", c.in, got.Expr, got.Description())
		}
	}
}

func TestCompileRejectsInvalid(t *testing.T) {
	bad := []Schedule{
		{Kind: ""},
		{Kind: "monthly", Time: "09:00"},
		{Kind: "hourly", Minute: 60},
		{Kind: "hourly", Minute: -1},
		{Kind: "daily", Time: "24:00"},
		{Kind: "daily", Time: "9"},
		{Kind: "daily", Time: "09:5"},
		{Kind: "weekly", Time: "09:00", Day: 7},
		{Kind: "daily", Time: "09:00", Timezone: "Mars/Olympus"},
		{Kind: "cron", Cron: "* * * *"},
		{Kind: "cron", Cron: "60 * * * *"},
		{Kind: "cron", Cron: "* 24 * * *"},
		{Kind: "cron", Cron: "* * 0 * *"},
		{Kind: "cron", Cron: "* * * 13 *"},
		{Kind: "cron", Cron: "* * * * 8"},
		{Kind: "cron", Cron: "*/0 * * * *"},
		{Kind: "cron", Cron: "5-1 * * * *"},
		{Kind: "cron", Cron: "1,,2 * * * *"},
		{Kind: "cron", Cron: "a * * * *"},
	}
	for _, s := range bad {
		if _, err := Compile(s); err == nil {
			t.Fatalf("accepted %+v", s)
		}
	}
}

func TestNextOccurrences(t *testing.T) {
	utc := time.UTC
	edm := mustLoc(t, "America/Edmonton")
	cases := []struct {
		name  string
		sched Schedule
		after time.Time
		want  []time.Time
	}{
		{"weekdays skip weekend", Schedule{Kind: "weekdays", Time: "09:00", Timezone: "America/Edmonton"},
			time.Date(2026, 10, 9, 10, 0, 0, 0, edm), // Friday after 09:00
			[]time.Time{time.Date(2026, 10, 12, 9, 0, 0, 0, edm), time.Date(2026, 10, 13, 9, 0, 0, 0, edm)}},
		{"weekdays same day before time", Schedule{Kind: "weekdays", Time: "09:00", Timezone: "America/Edmonton"},
			time.Date(2026, 10, 7, 8, 59, 30, 0, edm),
			[]time.Time{time.Date(2026, 10, 7, 9, 0, 0, 0, edm)}},
		{"exactly at occurrence is exclusive", Schedule{Kind: "daily", Time: "09:00", Timezone: "UTC"},
			time.Date(2026, 10, 7, 9, 0, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 8, 9, 0, 0, 0, utc)}},
		{"hourly", Schedule{Kind: "hourly", Minute: 15, Timezone: "UTC"},
			time.Date(2026, 10, 7, 23, 20, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 8, 0, 15, 0, 0, utc), time.Date(2026, 10, 8, 1, 15, 0, 0, utc)}},
		{"weekly thursday", Schedule{Kind: "weekly", Day: 4, Time: "14:00", Timezone: "UTC"},
			time.Date(2026, 10, 8, 14, 0, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 15, 14, 0, 0, 0, utc)}},
		{"step every 15", Schedule{Kind: "cron", Cron: "*/15 * * * *", Timezone: "UTC"},
			time.Date(2026, 10, 7, 10, 7, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 7, 10, 15, 0, 0, utc), time.Date(2026, 10, 7, 10, 30, 0, 0, utc), time.Date(2026, 10, 7, 10, 45, 0, 0, utc)}},
		{"range with step and list", Schedule{Kind: "cron", Cron: "0 8-12/2,20 * * *", Timezone: "UTC"},
			time.Date(2026, 10, 7, 9, 0, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 7, 10, 0, 0, 0, utc), time.Date(2026, 10, 7, 12, 0, 0, 0, utc), time.Date(2026, 10, 7, 20, 0, 0, 0, utc), time.Date(2026, 10, 8, 8, 0, 0, 0, utc)}},
		{"dom or dow when both restricted", Schedule{Kind: "cron", Cron: "0 0 13 * 5", Timezone: "UTC"},
			time.Date(2026, 11, 1, 0, 0, 0, 0, utc), // Nov 6 & 13 are Fridays; Nov 13 also dom
			[]time.Time{time.Date(2026, 11, 6, 0, 0, 0, 0, utc), time.Date(2026, 11, 13, 0, 0, 0, 0, utc), time.Date(2026, 11, 20, 0, 0, 0, 0, utc)}},
		{"dom star restricts by dow only", Schedule{Kind: "cron", Cron: "0 0 * * 1", Timezone: "UTC"},
			time.Date(2026, 10, 7, 0, 0, 0, 0, utc),
			[]time.Time{time.Date(2026, 10, 12, 0, 0, 0, 0, utc)}},
		{"dow 7 is sunday and names", Schedule{Kind: "cron", Cron: "30 6 * jan-feb 7", Timezone: "UTC"},
			time.Date(2026, 10, 7, 0, 0, 0, 0, utc),
			[]time.Time{time.Date(2027, 1, 3, 6, 30, 0, 0, utc)}},
		{"leap day", Schedule{Kind: "cron", Cron: "0 0 29 2 *", Timezone: "UTC"},
			time.Date(2026, 10, 7, 0, 0, 0, 0, utc),
			[]time.Time{time.Date(2028, 2, 29, 0, 0, 0, 0, utc)}},
	}
	for _, c := range cases {
		cs, err := Compile(c.sched)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		got := cs.NextN(c.after, len(c.want))
		if len(got) != len(c.want) {
			t.Fatalf("%s: got %v", c.name, got)
		}
		for i := range got {
			if !got[i].Equal(c.want[i]) {
				t.Fatalf("%s[%d]: got %v want %v", c.name, i, got[i], c.want[i])
			}
		}
	}
}

func TestNextNeverFires(t *testing.T) {
	cs, err := Compile(Schedule{Kind: "cron", Cron: "0 0 31 2 *", Timezone: "UTC"})
	if err != nil {
		t.Fatal(err)
	}
	if n := cs.Next(time.Now()); !n.IsZero() {
		t.Fatal(n)
	}
}

func TestNextDSTTransitions(t *testing.T) {
	edm := mustLoc(t, "America/Edmonton")
	// 2026-03-08 02:00 MST -> 03:00 MDT.
	daily, _ := Compile(Schedule{Kind: "daily", Time: "02:30", Timezone: "America/Edmonton"})
	got := daily.NextN(time.Date(2026, 3, 7, 3, 0, 0, 0, edm), 3)
	want := []time.Time{
		time.Date(2026, 3, 8, 3, 0, 0, 0, edm), // gap: fires at the first instant after it
		time.Date(2026, 3, 9, 2, 30, 0, 0, edm),
	}
	if !got[0].Equal(want[0]) || !got[1].Equal(want[1]) {
		t.Fatalf("spring forward daily: %v", got)
	}
	if got[0].Sub(time.Date(2026, 3, 7, 2, 30, 0, 0, edm)) != 23*time.Hour+30*time.Minute {
		t.Fatalf("gap instant wrong: %v", got[0])
	}
	hourly, _ := Compile(Schedule{Kind: "hourly", Minute: 30, Timezone: "America/Edmonton"})
	got = hourly.NextN(time.Date(2026, 3, 8, 1, 0, 0, 0, edm), 2)
	if !got[0].Equal(time.Date(2026, 3, 8, 1, 30, 0, 0, edm)) || got[1].Sub(got[0]) != time.Hour {
		t.Fatalf("spring forward hourly must skip the missing wall hour without duplicates: %v", got)
	}
	// 2026-11-01 02:00 MDT -> 01:00 MST: 01:30 happens twice but fires once.
	fall, _ := Compile(Schedule{Kind: "daily", Time: "01:30", Timezone: "America/Edmonton"})
	got = fall.NextN(time.Date(2026, 10, 31, 12, 0, 0, 0, edm), 2)
	if got[0].Day() != 1 || got[0].Hour() != 1 || got[0].Minute() != 30 || got[1].Day() != 2 || got[1].Hour() != 1 {
		t.Fatalf("fall back daily: %v", got)
	}
	weekdays, _ := Compile(Schedule{Kind: "weekdays", Time: "09:00", Timezone: "America/Edmonton"})
	got = weekdays.NextN(time.Date(2026, 10, 30, 10, 0, 0, 0, edm), 1) // Friday
	if !got[0].Equal(time.Date(2026, 11, 2, 9, 0, 0, 0, edm)) || got[0].UTC().Hour() != 16 {
		t.Fatalf("weekday across fall back must keep 09:00 wall time: %v (%v)", got[0], got[0].UTC())
	}
}

func TestLatestDue(t *testing.T) {
	utc := time.UTC
	hourly, _ := Compile(Schedule{Kind: "hourly", Minute: 0, Timezone: "UTC"})
	from := time.Date(2026, 10, 7, 10, 0, 0, 0, utc)
	if got := hourly.LatestDue(from, time.Date(2026, 10, 7, 15, 20, 0, 0, utc)); !got.Equal(time.Date(2026, 10, 7, 15, 0, 0, 0, utc)) {
		t.Fatal(got)
	}
	if got := hourly.LatestDue(from, from); !got.Equal(from) {
		t.Fatal(got)
	}
	if got := hourly.LatestDue(from, from.Add(-time.Minute)); !got.IsZero() {
		t.Fatal(got)
	}
	minutely, _ := Compile(Schedule{Kind: "cron", Cron: "* * * * *", Timezone: "UTC"})
	now := time.Date(2027, 10, 7, 10, 0, 30, 0, utc)
	start := time.Now()
	if got := minutely.LatestDue(from, now); !got.Equal(time.Date(2027, 10, 7, 10, 0, 0, 0, utc)) {
		t.Fatal(got)
	}
	weekly, _ := Compile(Schedule{Kind: "weekly", Day: 1, Time: "09:00", Timezone: "UTC"})
	if got := weekly.LatestDue(time.Date(2026, 1, 5, 9, 0, 0, 0, utc), now); !got.Equal(time.Date(2027, 10, 4, 9, 0, 0, 0, utc)) {
		t.Fatal(got)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("LatestDue too slow: %v", time.Since(start))
	}
}
