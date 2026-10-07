import { useCallback, useState } from 'react'
import { useAppStore } from '@core/store'
import type { TabGroupLayoutNode, WorkspaceContextID } from '@core/store/types'
import { collectGroupIds } from '@core/store/group-helpers'
import { TabGroupPanel } from './tabs/TabGroupPanel'

interface SplitLayoutProps {
  projectId: WorkspaceContextID
  layout: TabGroupLayoutNode
  onInspectTask?: (identifier: string) => void
  onToggleTools?: () => void
}

export function SplitLayout({ projectId, layout, onInspectTask, onToggleTools }: SplitLayoutProps) {
  return (
    <div className="h-full w-full min-h-0 min-w-0 bg-background">
      <SplitNode projectId={projectId} layout={layout} path="" onInspectTask={onInspectTask} onToggleTools={onToggleTools} />
    </div>
  )
}

interface SplitNodeProps {
  projectId: WorkspaceContextID
  layout: TabGroupLayoutNode
  path: string
  onInspectTask?: (identifier: string) => void
  onToggleTools?: () => void
}

function SplitNode({ projectId, layout, path, onInspectTask, onToggleTools }: SplitNodeProps) {
  const groups = useAppStore((s) => s.projectGroups[projectId] ?? {})
  const focusedGroupId = useAppStore((s) => s.projectFocusedGroupId[projectId] ?? '')
  const fullLayout = useAppStore((s) => s.projectLayouts[projectId])

  if (layout.kind === 'leaf') {
    const group = groups[layout.groupId]
    if (!group) return null
    const siblingIds = fullLayout ? collectGroupIds(fullLayout) : []
    return (
      <TabGroupPanel
        projectId={projectId}
        group={group}
        isFocused={layout.groupId === focusedGroupId}
        siblingGroupIds={siblingIds}
        onInspectTask={onInspectTask}
        onToggleTools={onToggleTools}
      />
    )
  }
  return <SplitBranch projectId={projectId} layout={layout} path={path} onInspectTask={onInspectTask} onToggleTools={onToggleTools} />
}

function SplitBranch({ projectId, layout, path, onInspectTask, onToggleTools }: SplitNodeProps & { layout: Extract<TabGroupLayoutNode, { kind: 'split' }> }) {
  const setRatio = useAppStore((s) => s.setGroupSplitRatio)
  const isHorizontal = layout.direction === 'horizontal'
  const firstFlex = `${layout.ratio * 100}%`
  const secondFlex = `${(1 - layout.ratio) * 100}%`

  const onResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const handle = event.currentTarget
      const container = handle.parentElement
      if (!container) return
      handle.setPointerCapture(event.pointerId)

      const onMove = (moveEvent: PointerEvent) => {
        if (!handle.hasPointerCapture(event.pointerId)) return
        const rect = container.getBoundingClientRect()
        const ratio = isHorizontal
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height
        setRatio(projectId, path, ratio)
      }
      const cleanup = () => {
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', cleanup)
        handle.removeEventListener('pointercancel', cleanup)
        handle.removeEventListener('lostpointercapture', cleanup)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', cleanup)
      handle.addEventListener('pointercancel', cleanup)
      handle.addEventListener('lostpointercapture', cleanup)
    },
    [isHorizontal, path, projectId, setRatio],
  )

  const [hovering, setHovering] = useState(false)

  return (
    <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} h-full w-full min-h-0 min-w-0`}>
      <div className="min-h-0 min-w-0" style={{ flexBasis: firstFlex, flexGrow: 0, flexShrink: 1 }}>
        <SplitNode projectId={projectId} layout={layout.first} path={path === '' ? 'first' : `${path}.first`} onInspectTask={onInspectTask} onToggleTools={onToggleTools} />
      </div>
      <div
        onPointerDown={onResize}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={`shrink-0 transition-colors ${
          isHorizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
        } ${hovering ? 'bg-primary/50' : 'bg-border/40'}`}
      />
      <div className="min-h-0 min-w-0" style={{ flexBasis: secondFlex, flexGrow: 0, flexShrink: 1 }}>
        <SplitNode projectId={projectId} layout={layout.second} path={path === '' ? 'second' : `${path}.second`} onInspectTask={onInspectTask} onToggleTools={onToggleTools} />
      </div>
    </div>
  )
}
