/**
 * Pure helpers for navigating + mutating the per-project tab-group layout tree.
 * The tree leaves carry a `groupId`; branches are splits.
 */

import type { CenterTabState, CenterTabType, SideTabType, TabGroupLayoutNode, TabRef, TerminalSplit } from './types'

/** The panes of a terminal tab; an unsplit tab is a single pane holding the tab's own terminal. */
export function terminalSplitFor(center: CenterTabState | undefined, tabId: string): TerminalSplit {
  return center?.terminalSplits?.[tabId] ?? { panes: [tabId], focusedId: tabId, sizes: [1] }
}

const CENTER_TAB_TYPES: ReadonlySet<TabRef['type']> = new Set<CenterTabType>(['editor', 'browser', 'terminal', 'conversations'])

/** Terminal, browser, editor and conversations tabs live in the center pane. */
export function isCenterTab(ref: TabRef): ref is Extract<TabRef, { type: CenterTabType }> {
  return CENTER_TAB_TYPES.has(ref.type)
}

/** Files and Git tabs live in the right tools panel. */
export function isSideTab(ref: TabRef): ref is Extract<TabRef, { type: SideTabType }> {
  return !CENTER_TAB_TYPES.has(ref.type)
}

/** Generate a short, unique-enough group id. */
export function newGroupId(): string {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Walk the tree and collect every leaf's groupId. */
export function collectGroupIds(node: TabGroupLayoutNode): string[] {
  if (node.kind === 'leaf') return [node.groupId]
  return [...collectGroupIds(node.first), ...collectGroupIds(node.second)]
}

/**
 * Replace the leaf `groupId` with a split that contains `groupId` on one side
 * and `newGroupId` on the other. Returns a new tree.
 *  - 'horizontal' = side-by-side (new group on the right)
 *  - 'vertical' = stacked (new group on the bottom)
 */
export function splitLeaf(
  node: TabGroupLayoutNode,
  groupId: string,
  direction: 'horizontal' | 'vertical',
  newGroupId: string,
): TabGroupLayoutNode {
  if (node.kind === 'leaf') {
    if (node.groupId !== groupId) return node
    return {
      kind: 'split',
      direction,
      first: { kind: 'leaf', groupId },
      second: { kind: 'leaf', groupId: newGroupId },
      ratio: 0.5,
    }
  }
  return {
    ...node,
    first: splitLeaf(node.first, groupId, direction, newGroupId),
    second: splitLeaf(node.second, groupId, direction, newGroupId),
  }
}

/**
 * Remove a leaf with the given `groupId` from the tree. The sibling collapses
 * upward. Returns null if the entire tree was a single leaf with that id.
 */
export function removeLeaf(
  node: TabGroupLayoutNode,
  groupId: string,
): TabGroupLayoutNode | null {
  if (node.kind === 'leaf') {
    return node.groupId === groupId ? null : node
  }
  const first = removeLeaf(node.first, groupId)
  const second = removeLeaf(node.second, groupId)
  if (first === null && second === null) return null
  if (first === null) return second
  if (second === null) return first
  return { ...node, first, second }
}

/** Return a new tree with the node at `path` updated. */
export function updateNodeAtPath(
  node: TabGroupLayoutNode,
  path: string,
  update: (n: TabGroupLayoutNode) => TabGroupLayoutNode,
): TabGroupLayoutNode {
  if (path === '') return update(node)
  const [head, ...rest] = path.split('.')
  if (node.kind !== 'split') return node
  const restPath = rest.join('.')
  if (head === 'first') return { ...node, first: updateNodeAtPath(node.first, restPath, update) }
  if (head === 'second') return { ...node, second: updateNodeAtPath(node.second, restPath, update) }
  return node
}
