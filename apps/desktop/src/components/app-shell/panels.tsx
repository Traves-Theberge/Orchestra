import { useEffect, useState, type ReactNode } from 'react'
import { Activity, AlertTriangle, Wrench } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { TimelineItem } from '@/components/app-shell/types'
import type { BackendConfig } from '@/lib/orchestra-client'
import type { SnapshotPayload } from '@/lib/orchestra-types'
import { getSortedRetryEntries, getSortedRunningEntries } from '@/lib/view-models'

type BackendProfile = {
  id: string
  name: string
  baseUrl: string
  apiToken: string
}

export function StatusStrip({
  statusMessage,
  errorMessage,
  generatedAt,
  onDownloadDiagnostics,
}: {
  statusMessage: string
  errorMessage: string
  generatedAt: string
  onDownloadDiagnostics?: () => void
}) {
  return (
    <section className="mt-4 rounded-xl border bg-card p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:bg-card dark:shadow-[0_8px_24px_rgba(0,0,0,0.32)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="border bg-muted/50 text-foreground dark:text-foreground">
            Runtime
          </Badge>
          <span className="text-muted-foreground">Last snapshot:</span>
          <span className="text-foreground dark:text-muted-foreground">{generatedAt}</span>
        </div>

        {onDownloadDiagnostics ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground" onClick={onDownloadDiagnostics}>
            Download Diagnostics
          </Button>
        ) : null}
      </div>

      {statusMessage ? (
        <div
          className="mt-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-foreground dark:text-foreground"
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-2 rounded-lg border border-red-800/80 bg-red-950/35 px-3 py-2 text-sm text-red-200" role="alert" aria-live="assertive">
          {errorMessage}
        </div>
      ) : null}
    </section>
  )
}

export function RunningIssuesCard({
  loadingState,
  snapshot,
  onInspectIssue,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
}) {
  const runningRows = getSortedRunningEntries(snapshot?.running ?? [])

  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle>Running Issues</CardTitle>
        <CardDescription>Live sessions from runtime snapshot</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issue</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Session</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingState
              ? Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell colSpan={3}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : runningRows.map((row) => (
                  <TableRow key={row.issue_id}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-left text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                        onClick={() => void onInspectIssue(row.issue_identifier)}
                        title="Inspect issue details"
                      >
                        {row.issue_identifier}
                      </button>
                    </TableCell>
                    <TableCell>{row.state}</TableCell>
                    <TableCell>{row.session_id || 'n/a'}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function RetryQueueCard({
  snapshot,
  onInspectIssue,
}: {
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
}) {
  const retryRows = getSortedRetryEntries(snapshot?.retrying ?? [])

  return (
    <Card className="h-full border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle>Retry Queue</CardTitle>
        <CardDescription>Upcoming retries and failure causes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {retryRows.map((entry) => (
          <div key={entry.issue_id} className="rounded-md border bg-muted/50 p-3 text-sm dark:bg-muted/50">
            <button
              type="button"
              className="font-medium text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
              onClick={() => void onInspectIssue(entry.issue_identifier)}
              title="Inspect issue details"
            >
              {entry.issue_identifier}
            </button>
            <div className="text-muted-foreground">attempt={entry.attempt}</div>
            <div className="text-muted-foreground">due_at={entry.due_at}</div>
            <Badge variant="outline" className="mt-2 border text-muted-foreground">
              {entry.error || 'retry'}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function TimelineCard({ timeline }: { timeline: TimelineItem[] }) {
  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Lifecycle Timeline
        </CardTitle>
        <CardDescription>Most recent non-snapshot event envelopes from `/api/v1/events`.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {timeline.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            No lifecycle events received yet.
          </div>
        ) : (
          timeline.map((item, idx) => (
            <div key={`${item.type}-${idx}`} className="rounded-md border bg-muted/50 p-2 text-xs dark:bg-muted/50">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant="secondary">{item.type}</Badge>
                <span className="text-muted-foreground">{item.at}</span>
              </div>
              <pre className="overflow-auto whitespace-pre-wrap text-foreground dark:text-muted-foreground">{JSON.stringify(item.data, null, 2)}</pre>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

export function SettingsCard({
  loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  migrationPending,
  migrationFrom,
  migrationTo,
  migrationPlan,
  onMigrationFromChange,
  onMigrationToChange,
  onMigrationPlan,
  onMigrationApply,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  migrationPending: boolean
  migrationFrom: string
  migrationTo: string
  migrationPlan: Record<string, unknown> | null
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
}) {
  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Backend connection and workspace migration tools are grouped here.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-foreground dark:text-muted-foreground">
        <div className="space-y-2 rounded-lg border bg-muted/50 p-3 dark:bg-muted/50">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Backend Configuration</p>
          <BackendConfigForm
            loadingConfig={loadingConfig}
            savingConfig={savingConfig}
            profilesPending={profilesPending}
            config={config}
            backendProfiles={backendProfiles}
            activeProfileId={activeProfileId}
            onSaveBackendConfig={onSaveBackendConfig}
            onSetActiveProfile={onSetActiveProfile}
            onCreateProfile={onCreateProfile}
            onDeleteProfile={onDeleteProfile}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceMigrationDialog
            migrationPending={migrationPending}
            config={config}
            migrationFrom={migrationFrom}
            migrationTo={migrationTo}
            migrationPlan={migrationPlan}
            onMigrationFromChange={onMigrationFromChange}
            onMigrationToChange={onMigrationToChange}
            onMigrationPlan={onMigrationPlan}
            onMigrationApply={onMigrationApply}
          />
        </div>
        <p className="text-muted-foreground">Next: persist profile presets and secure token vault integration.</p>
      </CardContent>
    </Card>
  )
}

export function IssueDetailView({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
                {(result.identifier as string) || (result.id as string)}
              </Badge>
              <span className="text-xs text-muted-foreground">in {(result.team_id as string) || 'unknown team'}</span>
            </div>
            <h3 className="mt-1 truncate text-lg font-semibold text-foreground">{(result.title as string) || 'No Title'}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
              Change State
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
              Assign
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">State</p>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-primary" />
              <span className="font-medium">{(result.state as string) || 'n/a'}</span>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Assignee</p>
            <p className="font-medium">{(result.assignee_id as string) || 'Unassigned'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Project</p>
            <p className="font-medium">{(result.project_id as string) || 'None'}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Labels</p>
            <div className="flex flex-wrap gap-1">
              {Array.isArray(result.labels) && result.labels.length > 0 ? (
                result.labels.map((label: string) => (
                  <Badge key={label} variant="secondary" className="px-1.5 py-0 text-[10px]">
                    {label}
                  </Badge>
                ))
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </div>
          </div>
        </div>

        {(result.description as string) ? (
          <div className="mt-4 border-t pt-4">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Description</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-clamp-10">
              {result.description as string}
            </p>
          </div>
        ) : null}
      </div>

      <Dialog>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground hover:text-foreground">
            View Raw JSON Payload
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Raw Issue Payload</DialogTitle>
            <DialogDescription>Snapshot of the issue data from the tracker contract.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[500px] overflow-auto rounded-md border bg-muted p-4 text-[10px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function IssueInspectorCard({
  configReady,
  issueLookupId,
  issueLookupPending,
  issueLookupError,
  issueLookupResult,
  onIssueLookupIdChange,
  onIssueLookup,
}: {
  configReady: boolean
  issueLookupId: string
  issueLookupPending: boolean
  issueLookupError: string
  issueLookupResult: Record<string, unknown> | null
  onIssueLookupIdChange: (value: string) => void
  onIssueLookup: () => Promise<void>
}) {
  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle>Issue Inspector</CardTitle>
        <CardDescription>
          Direct issue payload lookup mapped to <code>/api/v1/{'{'}issue_identifier{'}'}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-9 min-w-64 rounded-md border border-border bg-background px-3 text-sm"
            value={issueLookupId}
            onChange={(event) => onIssueLookupIdChange(event.target.value)}
            placeholder="e.g. OPS-123"
          />
          <Button onClick={() => void onIssueLookup()} disabled={!configReady || issueLookupPending || issueLookupId.trim() === ''}>
            {issueLookupPending ? 'Loading...' : 'Fetch Issue'}
          </Button>
        </div>

        {issueLookupError ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-900 dark:border-red-900/70 dark:bg-red-950/35 dark:text-red-200">
            {issueLookupError}
          </div>
        ) : null}

        {issueLookupResult ? <IssueDetailView result={issueLookupResult} /> : null}
      </CardContent>
    </Card>
  )
}

function BackendConfigForm({
  loadingConfig,
  savingConfig,
  profilesPending,
  config,
  backendProfiles,
  activeProfileId,
  onSaveBackendConfig,
  onSetActiveProfile,
  onCreateProfile,
  onDeleteProfile,
}: {
  loadingConfig: boolean
  savingConfig: boolean
  profilesPending: boolean
  config: BackendConfig | null
  backendProfiles: BackendProfile[]
  activeProfileId: string
  onSaveBackendConfig: (nextConfig: BackendConfig) => Promise<void>
  onSetActiveProfile: (profileId: string) => Promise<void>
  onCreateProfile: (name: string) => Promise<void>
  onDeleteProfile: (profileId: string) => Promise<void>
}) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [newProfileName, setNewProfileName] = useState('')

  useEffect(() => {
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }, [config])

  const syncFromConfig = () => {
    setBaseUrl(config?.baseUrl ?? '')
    setApiToken(config?.apiToken ?? '')
  }

  const disabled = loadingConfig || savingConfig || profilesPending

  return (
    <div className="space-y-2">
      <label className="block text-xs text-muted-foreground">
        Profile
        <div className="mt-1 flex gap-2">
          <select
            className="h-9 min-w-56 rounded-md border border-border bg-background px-3 text-sm"
            value={activeProfileId}
            onChange={(event) => {
              void onSetActiveProfile(event.target.value)
            }}
            disabled={disabled || backendProfiles.length === 0}
          >
            {backendProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
            disabled={disabled || backendProfiles.length <= 1 || activeProfileId === ''}
            onClick={() => {
              if (activeProfileId !== '') {
                void onDeleteProfile(activeProfileId)
              }
            }}
          >
            Delete
          </Button>
        </div>
      </label>
      <label className="block text-xs text-muted-foreground">
        New Profile Name
        <div className="mt-1 flex gap-2">
          <input
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
            value={newProfileName}
            onChange={(event) => setNewProfileName(event.target.value)}
            placeholder="Production, Staging, Local..."
            disabled={disabled}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
            disabled={disabled || newProfileName.trim() === ''}
            onClick={() => {
              void onCreateProfile(newProfileName.trim())
              setNewProfileName('')
            }}
          >
            Create
          </Button>
        </div>
      </label>
      <label className="block text-xs text-muted-foreground">
        Base URL
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="http://127.0.0.1:4000"
          disabled={disabled}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        API Token
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={apiToken}
          onChange={(event) => setApiToken(event.target.value)}
          placeholder="optional bearer token"
          disabled={disabled}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent"
          onClick={syncFromConfig}
          disabled={disabled}
        >
          Reset
        </Button>
        <Button onClick={() => void onSaveBackendConfig({ baseUrl: baseUrl.trim(), apiToken: apiToken.trim() })} disabled={disabled || baseUrl.trim() === ''}>
          {savingConfig ? 'Saving...' : 'Save Backend Config'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Updates the preload-stored backend target used by runtime state/SSE requests.</p>
    </div>
  )
}

function WorkspaceMigrationDialog({
  migrationPending,
  config,
  migrationFrom,
  migrationTo,
  migrationPlan,
  onMigrationFromChange,
  onMigrationToChange,
  onMigrationPlan,
  onMigrationApply,
}: {
  migrationPending: boolean
  config: BackendConfig | null
  migrationFrom: string
  migrationTo: string
  migrationPlan: Record<string, unknown> | null
  onMigrationFromChange: (value: string) => void
  onMigrationToChange: (value: string) => void
  onMigrationPlan: () => Promise<void>
  onMigrationApply: () => Promise<void>
}) {
  const [confirmApply, setConfirmApply] = useState(false)

  const handleApply = () => {
    if (!confirmApply) {
      setConfirmApply(true)
      return
    }
    void onMigrationApply()
    setConfirmApply(false)
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-full border bg-muted/50 px-4 text-foreground hover:bg-accent dark:text-foreground dark:hover:bg-accent">
          Workspace Migration
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Workspace Migration</DialogTitle>
          <DialogDescription>Mapped to `/api/v1/workspace/migration/plan` and `/api/v1/workspace/migrate`.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">From</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={migrationFrom}
              onChange={(event) => onMigrationFromChange(event.target.value)}
              placeholder="optional source path"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">To</span>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={migrationTo}
              onChange={(event) => onMigrationToChange(event.target.value)}
              placeholder="optional target path"
            />
          </label>
          {migrationPlan ? (
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3 text-xs">{JSON.stringify(migrationPlan, null, 2)}</pre>
          ) : null}
          {confirmApply ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
              Confirm migration apply. This triggers `/api/v1/workspace/migrate`.
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setConfirmApply(false)
              void onMigrationPlan()
            }}
            disabled={migrationPending || !config}
          >
            Plan
          </Button>
          <Button onClick={handleApply} disabled={migrationPending || !config}>
            {confirmApply ? 'Confirm Apply' : 'Apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function MetricCard({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: ReactNode }) {
  return (
    <Card className="relative overflow-hidden border bg-card shadow-lg dark:bg-card">
      <div className="pointer-events-none absolute -right-10 -top-10 h-24 w-24 rotate-12 rounded-xl border bg-muted/50 dark:bg-muted/50" />
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center justify-between">
          <span>{title}</span>
          {icon}
        </CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

type QueueRow = {
  issue_id: string
  issue_identifier: string
  state: string
  lane: 'running' | 'retrying'
  session_id: string
  detail: string
  at: string
}

function queueRowsFromSnapshot(snapshot: SnapshotPayload | null): QueueRow[] {
  if (!snapshot) {
    return []
  }

  const runningRows: QueueRow[] = getSortedRunningEntries(snapshot.running).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'running',
    session_id: row.session_id ?? 'n/a',
    detail: row.last_message || row.last_event || 'active runtime session',
    at: row.last_event_at || row.started_at || snapshot.generated_at,
  }))

  const retryRows: QueueRow[] = getSortedRetryEntries(snapshot.retrying).map((row) => ({
    issue_id: row.issue_id,
    issue_identifier: row.issue_identifier,
    state: row.state,
    lane: 'retrying',
    session_id: 'retry-queue',
    detail: row.error || `attempt ${row.attempt}`,
    at: row.due_at,
  }))

  return [...runningRows, ...retryRows].sort((a, b) => a.issue_identifier.localeCompare(b.issue_identifier, 'en', { sensitivity: 'base' }))
}

export function KanbanBoard({
  loadingState,
  snapshot,
  doneItems = [],
  onInspectIssue,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  doneItems?: any[]
  onInspectIssue: (issueIdentifier: string) => Promise<void>
}) {
  const todoItems = getSortedRetryEntries(snapshot?.retrying ?? [])
  const inProgressItems = getSortedRunningEntries(snapshot?.running ?? [])
...
  const columns = [
    { id: 'todo', title: 'To Do', items: todoItems, icon: <div className="h-2 w-2 rounded-full border-2 border-muted-foreground" /> },
    { id: 'progress', title: 'In Progress', items: inProgressItems, icon: <div className="h-2 w-2 rounded-full border-2 border-amber-500 bg-amber-500" /> },
    { id: 'done', title: 'Done', items: doneItems, icon: <div className="h-2 w-2 rounded-full bg-primary" /> },
  ]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {columns.map((column) => (
        <div key={column.id} className="flex flex-col gap-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              {column.icon}
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{column.title}</h3>
              <span className="text-[11px] font-medium text-muted-foreground/50">{column.items.length}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:bg-muted/50">
              <span className="text-lg font-light">+</span>
            </Button>
          </div>

          <div className="flex min-h-[500px] flex-col gap-2 rounded-xl bg-muted/10 p-1.5 transition-colors hover:bg-muted/20">
            {loadingState ? (
              Array.from({ length: 3 }).map((_, idx) => <Skeleton key={idx} className="h-28 w-full rounded-lg" />)
            ) : column.items.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="mb-2 h-8 w-8 rounded-full border-2 border-dashed border-muted-foreground/20" />
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40">Empty</p>
              </div>
            ) : (
              column.items.map((item) => (
                <Card
                  key={item.issue_id}
                  className="group relative cursor-pointer border-transparent bg-card p-3 shadow-sm transition-all hover:border-primary/20 hover:shadow-md active:scale-[0.98]"
                  onClick={() => void onInspectIssue(item.issue_identifier)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[10px] font-semibold tracking-tight text-muted-foreground/80">
                      {item.issue_identifier}
                    </span>
                    <span className="text-[9px] font-medium text-muted-foreground/40">
                      {(item as any).at ? new Date((item as any).at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (item as any).due_at ? 'Retry' : ''}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-tight text-foreground/90">
                    {(item as any).last_message || (item as any).error || 'No message'}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full bg-primary/20" />
                      <span className="text-[10px] font-medium text-muted-foreground/60">{item.state}</span>
                    </div>
                    {(item as any).session_id ? (
                      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-tighter text-amber-500/80">
                        <Activity className="h-2.5 w-2.5" />
                        <span>Live</span>
                      </div>
                    ) : null}
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function OperationsQueueCard({
  loadingState,
  snapshot,
  onInspectIssue,
}: {
  loadingState: boolean
  snapshot: SnapshotPayload | null
  onInspectIssue: (issueIdentifier: string) => Promise<void>
}) {
  const [laneFilter, setLaneFilter] = useState<'all' | 'running' | 'retrying'>('all')
  const [stateFilter, setStateFilter] = useState<string>('all')

  const allRows = queueRowsFromSnapshot(snapshot)
  const uniqueStates = Array.from(new Set(allRows.map((row) => row.state))).sort()

  const rows = allRows.filter((row) => {
    const laneMatch = laneFilter === 'all' || row.lane === laneFilter
    const stateMatch = stateFilter === 'all' || row.state === stateFilter
    return laneMatch && stateMatch
  })

  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Operations Queue</CardTitle>
            <CardDescription>Linear-style queue surface for active and retrying runtime work.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={laneFilter}
              onChange={(e) => setLaneFilter(e.target.value as any)}
            >
              <option value="all">All Lanes</option>
              <option value="running">Running</option>
              <option value="retrying">Retrying</option>
            </select>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="all">All States</option>
              {uniqueStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issue</TableHead>
              <TableHead>Lane</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Session</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingState
              ? Array.from({ length: 3 }).map((_, idx) => (
                  <TableRow key={idx}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              : rows.map((row) => (
                  <TableRow key={`${row.lane}-${row.issue_id}`}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-left text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                        onClick={() => void onInspectIssue(row.issue_identifier)}
                        title="Inspect issue details"
                      >
                        {row.issue_identifier}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.lane === 'running' ? 'default' : 'outline'}>{row.lane}</Badge>
                    </TableCell>
                    <TableCell>{row.state}</TableCell>
                    <TableCell>{row.session_id}</TableCell>
                    <TableCell className="max-w-[320px] truncate" title={row.detail}>
                      {row.detail}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.at}</TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

export function IntegrationUtilityCard({ tokenConfigured }: { tokenConfigured: boolean }) {
  const rows = [
    {
      name: 'Codex',
      role: 'Runtime orchestration provider and event source.',
      status: 'connected via backend',
    },
    {
      name: 'OpenCode',
      role: 'Desktop operator surface and local workflow tooling.',
      status: 'active in this app shell',
    },
    {
      name: 'Claude Code',
      role: 'Secondary coding/runtime workflow provider lane.',
      status: 'supported through backend contracts',
    },
    {
      name: 'Linear',
      role: 'Tracker semantics for issue/project state workflows.',
      status: 'clone phase in progress',
    },
  ]

  return (
    <Card className="border bg-card shadow-lg dark:bg-card">
      <CardHeader>
        <CardTitle>Integration Surface</CardTitle>
        <CardDescription>Current implementation lanes and how they map to operator utility.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {rows.map((row) => (
          <div key={row.name} className="rounded-md border bg-muted/40 p-3 dark:bg-muted/50">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="secondary">{row.name}</Badge>
              <span className="text-xs text-muted-foreground">{row.status}</span>
            </div>
            <p className="text-muted-foreground">{row.role}</p>
          </div>
        ))}
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          Auth mode: {tokenConfigured ? 'bearer token configured (polling fallback for SSE)' : 'local/no-token mode (SSE enabled when stream is healthy)'}.
        </div>
      </CardContent>
    </Card>
  )
}
