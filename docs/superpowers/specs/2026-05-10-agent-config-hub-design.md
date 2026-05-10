# Agent Config Hub Redesign

**Status:** Approved · ready for implementation plan
**Owner:** Traves
**Last touched:** 2026-05-10

## Problem

The Agents Dashboard is the place users configure how every coding agent
(Claude, Codex, Gemini, OpenCode) behaves — globally and per-project. It
exists today but feels incoherent:

- Each provider exposes a different subset of features and the UI just
  hides what's not supported, so switching tabs feels like things
  vanished.
- Panels look different from one another (some are forms, some lists,
  some single textareas). Save behavior, widths, and empty states are
  inconsistent.
- Global vs project is a small toggle in the corner. The single most
  important fact about a config — "what overrides what?" — is invisible.
- There's no orientation when you click a provider tab; you're dumped
  into the first panel with no context.
- The visual language doesn't match the rest of Orchestra.

This redesign treats the dashboard as a **configuration hub** with a
clear landing, an honest treatment of global/project relationships, and
a single visual system across all panels.

## Out of scope

- Backend changes to compute "effective merged config" — the UI renders
  global and project separately and surfaces the relationship through
  layout, not a server-computed merge.
- Compare-across-projects view.
- Global search across configs.
- Live preview of how an agent would behave with the proposed config.
- Diff visualization for project vs global text content (a future
  enhancement).
- Visual changes outside the Agents Dashboard.
- Any changes to the dispatch / `AssignedToWorker` plumbing — that's
  separate Kanban work tracked elsewhere.

## Decisions

| # | Topic | Choice |
|---|---|---|
| 1 | Top-level navigation | Provider-first tabs: Claude / Codex / Gemini / OpenCode |
| 2 | Provider asymmetry | Hide unsupported features from the sidebar entirely |
| 3 | Landing experience | New **Overview** panel as the default for every provider |
| 4 | Global vs Project | Side-by-side on the Overview, project selector top-right |
| 5 | Inside panels | Full-width editor; `[Global \| {Project}]` segmented toggle in the top bar |
| 6 | Visual feel | Editorial — airy typography, sentence-case labels, monospace reserved for file paths and identifiers |

## Architecture

### Layout shell

Every provider tab uses the same three-region shell. Provider tabs and
context cluster live in a single top bar; below that, a fixed-width
provider-specific sidebar; the rest is content.

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Claude] Codex Gemini OpenCode              vs [Nautilus ▾]        │
├─────────────┬───────────────────────────────────────────────────────┤
│  Sidebar    │  Eyebrow                                              │
│  Overview   │  Title                                                │
│  Settings   │  Sub                                                  │
│  ...        │                                                       │
│             │  body (form / editor / list+editor)                   │
│             │                                                       │
│             │                                  [Discard]  [Save]    │
└─────────────┴───────────────────────────────────────────────────────┘
```

- Top bar: provider tabs on the left, **context cluster** on the right.
  On Overview the context cluster reads `vs {Project ▾}`. Inside any
  other panel it reads `[Global | {Project}]` as a segmented toggle.
- Sidebar: ~140px. First row always `Overview`. Below: only the
  features this provider supports. No dimmed or "unavailable" entries.
- Content region: 18px padding. Consistent header (eyebrow / title /
  optional sub), then the panel body, then a right-aligned footer
  action row.

### The project selector

- Lives in the top-right of the top bar.
- Defaults to `useAppStore.selectedProjectID`. Changing it updates both
  the Overview right column and the scope toggle inside inner panels.
- First dropdown entry is **"Global only — hide project column"**.
  Selecting it collapses Overview to a single column and removes the
  segmented toggle from inner panels (you are editing global, full stop).
- Selection persists per session in the store.

### The Overview panel

A new panel that becomes the default landing for every provider tab.
Two-column editorial layout: left = Global, right = the selected project.

```
Eyebrow:  Claude / Configuration
Title:    Global & project overrides
Sub:      A side-by-side view of what applies everywhere and what's
          specific to Nautilus.

┌─────────────────────────────┬─────────────────────────────┐
│  GLOBAL                     │  NAUTILUS                   │
│  ──────────────────────     │  ──────────────────────     │
│  Model                      │  Model            override  │
│  Claude Sonnet 4.6          │  Claude Opus 4.7            │
│  ──────────────────────     │  ──────────────────────     │
│  Instructions               │  Instructions               │
│  CLAUDE.md                  │  +12 lines appended         │
│  42 lines · 1.2 kb          │                             │
│  ──────────────────────     │  ──────────────────────     │
│  Skills                     │  Skills           +1        │
│  2 enabled                  │  deploy-checklist           │
│  refactor, debugging        │                             │
└─────────────────────────────┴─────────────────────────────┘
```

Each row is clickable and jumps into the corresponding panel with the
right scope pre-selected. Inherited values on the project side render
in italic+dim with a small `+N appended` / `inherited` hint. Override
values get a small `override` pill — typography, not color.

If "Global only" is selected, the right column is hidden and the left
expands to full width.

### Panel archetypes

Every panel in the hub conforms to one of three shapes. Same header
pattern across all; bodies differ.

**Archetype A — Form** (Settings, Permissions, Model)

A field grid. Fields not set at the current scope render the inherited
value as a placeholder in italic+dim, with a "Set here" affordance on
hover.

```
[Global | Nautilus]                                  ← top-right
  Model            [ claude-opus-4-7    ▾ ]
  Max turns        [ 50                 ]
  Theme            [ inherits from global ]
  Verbose          [ ◯ off    ● on      ]
                                  [Discard]  [Save]
```

**Archetype B — Document editor** (Instructions, single-file panels)

A full-width Monaco editor in markdown mode. The sub-line carries the
merge semantics for the current panel (`appends to global` / `replaces
global` / `local only`).

```
Eyebrow:  Claude / Instructions
Title:    CLAUDE.md · Nautilus
Sub:      12 lines · appends to ~/.claude/CLAUDE.md

[Global | Nautilus]

┌─────────────────────────────────────────────────┐
│ Use TanStack Query for all server state.        │
│ Backend tests must hit a real SQLite, never...  │
│ ...                                             │
└─────────────────────────────────────────────────┘
                                [Discard]  [Save]
```

**Archetype C — Named-file list** (Skills, Rules, Sub-agents, MCP)

Two-pane: left rail with the list, right pane with the editor. Inherited
items render with a small `(G)` tag. Project items get a small accent
dot. New / delete actions live in the left rail.

```
Eyebrow:  Claude / Skills
Title:    Skills · Nautilus
Sub:      .claude/skills/ · 3 skills (2 inherited, 1 project)

[Global | Nautilus]

┌──────────────────────┬──────────────────────────────────────┐
│  + New skill         │  Eyebrow:  deploy-checklist          │
│                      │  Title:    deploy-checklist.md       │
│  deploy-checklist 🔵 │  Sub:      Project · 18 lines        │
│  refactor       (G)  │                                      │
│  debugging      (G)  │  ┌──────────────────────────────┐    │
│                      │  │ Monaco markdown editor       │    │
│                      │  └──────────────────────────────┘    │
│                      │             [Delete] [Discard] [Save]│
└──────────────────────┴──────────────────────────────────────┘
```

### Cross-cutting interaction rules

These apply identically everywhere — no per-panel exceptions.

- **Save:** always rendered in the footer. Disabled until dirty.
  Single primary button.
- **Discard:** appears next to Save only when dirty.
- **Dirty indicator:** small `Unsaved` pill next to the title.
- **Empty states:** when no file exists at the current scope, the body
  becomes a centered editorial card with a single Create CTA, e.g.
  ```
        No CLAUDE.md at this scope
        Project instructions append to global. Optional.
                  [ Create CLAUDE.md ]
  ```
- **Error feedback:** save failures surface as an inline strip above
  the footer (red border, single-line message, dismissible). No toasts.
- **Inheritance hints:** inherited values render `text-inherit`
  (italic + dim); hover reveals a "Set here" link that copies the
  inherited value into the local scope.

## Design system tokens

A small named palette every panel pulls from. Tailwind-flavored.

| Token | Value | Used for |
|---|---|---|
| `text-eyebrow` | `text-[10px] uppercase tracking-[0.14em] text-foreground/45` | "Claude / Instructions" |
| `text-title` | `text-[16px] font-semibold tracking-[-0.01em]` | Panel title |
| `text-sub` | `text-[11px] text-foreground/50` | One-line description |
| `text-meta` | `text-[10px] font-mono text-foreground/35` | File paths, sizes |
| `text-value` | `text-[13px] font-medium text-foreground` | Form values, card primaries |
| `text-inherit` | `text-[11px] italic text-foreground/35` | "inherits from global" |
| `text-override` | `text-[13px] font-medium text-[var(--accent)]` | Project override values |
| `pill-override` | `text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded-[3px] bg-accent/15 text-accent` | "override", "+1", "+12 appended" |
| `pill-unsaved` | same shape, `bg-amber-500/15 text-amber-400` | dirty indicator |
| `surface-global` | `bg-foreground/[0.02]` | Global column background |
| `surface-project` | `bg-accent/[0.04] border-accent/20` | Project column background |
| `surface-card` | `bg-card border border-border/40 rounded-lg` | Settings rows, list items |

Spacing scale: 18px content padding · 14px between header and body ·
10px between sibling rows. No double margins; no nested borders.

## File map

This is approximate — final structure is decided in the implementation
plan.

```
apps/desktop/src/features/agents/
├── AgentsDashboard.tsx                  (existing — provider shell)
├── components/
│   ├── PanelHeader.tsx                  NEW — eyebrow/title/sub
│   ├── PanelFooter.tsx                  NEW — Discard/Save row
│   ├── ScopeToggle.tsx                  NEW — [Global | Project]
│   ├── ProjectSelector.tsx              NEW — top-right dropdown
│   ├── OverviewRow.tsx                  NEW — Overview list row
│   ├── InheritedField.tsx               NEW — italic+dim placeholder
│   ├── EmptyStateCard.tsx               NEW — "No file at this scope"
│   └── ErrorStrip.tsx                   NEW — inline save error
├── panels/
│   ├── OverviewPanel.tsx                NEW — landing per provider
│   ├── SettingsPanel.tsx                refactored → Archetype A
│   ├── InstructionsPanel.tsx            refactored → Archetype B
│   ├── PermissionsPanel.tsx             refactored → Archetype A
│   ├── HooksPanel.tsx                   refactored → Archetype A
│   ├── MCPPanel.tsx                     refactored → Archetype C
│   ├── SkillsPanel.tsx                  refactored → Archetype C
│   ├── RulesPanel.tsx                   refactored → Archetype C
│   ├── SubAgentsPanel.tsx               refactored → Archetype C
│   ├── CodexConfigPanel.tsx             refactored → Archetype A
│   ├── CodexModelPanel.tsx              refactored → Archetype A
│   ├── GeminiSettingsPanel.tsx          refactored → Archetype A
│   ├── GeminiModelPanel.tsx             refactored → Archetype A
│   ├── GeminiPermissionsPanel.tsx       refactored → Archetype A
│   ├── OpenCodeConfigPanel.tsx          refactored → Archetype A
│   └── OpenCodeModelPanel.tsx           refactored → Archetype A
└── tokens.ts                            NEW — design system constants
```

## Risks & open questions

- **"Global only" as a magic dropdown entry.** Could be a separate
  toggle. Folding it into the project selector keeps the top bar
  cleaner — worth a usability check after first build.
- **Inheritance hint text** differs per panel: CLAUDE.md concatenates,
  settings.json shallow-merges, skills/rules/sub-agents union by
  filename, MCP merges by server name. A helper function chooses the
  right phrasing for each panel.
- **Cheap inheritance detection.** For named-file collections,
  inheritance is just "does the project file exist?" — easy. For
  settings keys it requires examining both files. The existing API
  returns both global and project payloads, so this is a frontend-only
  concern.

## Verification

Once implemented, the design is correct if:

- Clicking any provider tab lands on the Overview panel.
- The project selector defaults to the workspace's currently selected
  project; switching it updates both Overview and every inner panel.
- "Global only" collapses the Overview to a single column and hides the
  scope toggle inside panels.
- Every panel uses the same header pattern, save button placement,
  dirty pill, empty-state card, and error strip.
- Project overrides on the Overview render with the `override` pill
  and accent typography; inherited rows render `text-inherit`.
- Switching scope inside a panel does not lose unsaved changes silently
  — dirty state prompts a discard confirmation.
- Codex, Gemini, and OpenCode tabs show only the panels they actually
  support; no dimmed entries, no "unavailable" placeholders.
