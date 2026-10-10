import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatMessage } from '@features/workspace/chat/ChatMessage'
import { MessageBubble } from '@features/embedded-agent/components/MessageBubble'
import type { WorkspaceChatMessage } from '@core/api/client'
import { USER_SAMPLE } from './mermaidReflow.fixtures'

const SRC = join(__dirname, '..')
const PAGE = '```html\n<!DOCTYPE html>\n<html><body><svg viewBox="0 0 4 4"><circle r="2"/></svg></body></html>\n```'
const DIAGRAM = `\`${USER_SAMPLE}\``

/**
 * Surfaces that intentionally turn a rich renderer off. Everything else that
 * shows agent text must use MarkdownRenderer defaults (Mermaid + HTML preview on).
 */
const EXCEPTIONS: Record<string, string> = {
  'features/git/GitHubIssuesTab.tsx': 'enableHtmlPreview={false}: third-party GitHub issue bodies, not agent output; no interactive pages from external authors',
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('rich rendering is on for every message surface', () => {
  it('no MarkdownRenderer call site disables Mermaid or HTML preview except the documented exceptions', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('<MarkdownRenderer')) continue
      const rel = relative(SRC, file).replace(/\\/g, '/')
      if (/enableMermaid=\{false\}|enableHtmlPreview=\{false\}/.test(text) && !EXCEPTIONS[rel]) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  const message = (text: string): WorkspaceChatMessage => ({
    id: 'm', session_id: 's', role: 'assistant', text, status: 'completed', created_at: new Date().toISOString(),
  })

  it.each([
    ['workspace chat (saved message)', (text: string) => <ChatMessage message={message(text)} provider="antigravity" projectId="p" />],
    ['embedded agent widget', (text: string) => <MessageBubble message={{ id: 'm', role: 'assistant', content: text, createdAt: new Date() }} onAction={() => undefined} />],
    ['embedded agent widget (streaming)', (text: string) => <MessageBubble message={{ id: 'm', role: 'assistant', content: text, createdAt: new Date() }} onAction={() => undefined} isStreaming />],
  ])('%s renders the one-line diagram and a full html page', async (_label, view) => {
    const { unmount } = render(view(`Diagram:\n\n${DIAGRAM}\n\nPage:\n\n${PAGE}`))
    expect(await screen.findByTestId('mermaid-block')).toBeDefined()
    expect(screen.getByTestId('html-preview-block')).toBeDefined()
    unmount()
  })
})
