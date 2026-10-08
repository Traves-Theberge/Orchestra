import { useState } from 'react'
import type { BackendConfig } from '@core/api/client'
import { Button } from '@ui/button'
import { RunInspector } from './RunInspector'

export function TaskTimeline({ config, taskId, projectId }: { config: BackendConfig | null; taskId: string; projectId: string }) {
  const [live, setLive] = useState(true)
  if (!config) return <p className="p-4 text-sm text-muted-foreground">Connect a backend to inspect the task timeline.</p>
  if (!taskId || !projectId) return <p className="p-4 text-sm text-muted-foreground">Task and project identity are unavailable.</p>
  return <section aria-label="Task timeline" className="p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Task timeline</h3><Button size="sm" variant="outline" onClick={() => setLive(value => !value)}>{live ? 'Pause live updates' : 'Resume live updates'}</Button></div><RunInspector config={config} filter={{ task_id: taskId, project_id: projectId }} live={live} /></section>
}
