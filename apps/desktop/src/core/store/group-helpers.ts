/**
 * Pure helpers for navigating + mutating the per-project tab-group layout tree.
 * The tree leaves carry a `groupId`; branches are splits.
 */

import type { TabGroupLayoutNode } from './types'

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
