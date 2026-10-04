import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ChatUsage } from './ChatUsage'
import { chatUsageObservation } from './chat-usage-observation'
import type { WorkspaceChatEvent } from '@core/api/client'

afterEach(cleanup)
const usage = (turn: string, tokens: number): WorkspaceChatEvent => ({ type:'thread/tokenUsage/updated', sequence:1, turn_id:turn, created_at:'', payload:{tokenUsage:{total:{totalTokens:tokens},last:{inputTokens:0,outputTokens:0,cachedInputTokens:0},modelContextWindow:10000}} })
it('keeps late prior-turn usage from replacing the latest turn observation', () => {
  const events = [usage('a',100), {type:'turn/started',sequence:2,turn_id:'b',created_at:''}, usage('b',200), usage('a',150)]
  expect(chatUsageObservation(events).total.totalTokens).toBe(200)
  expect(chatUsageObservation(events.slice(0,2)).event).toBeUndefined()
})
it('shows measured zero separately from absent counters and reported capacity', () => {
  render(<ChatUsage events={[usage('a',0)]} />)
  expect(screen.getByText('Provider thread: 0 tokens')).toBeInTheDocument()
  expect(screen.getByText('Reported context window: 10,000 tokens')).toBeInTheDocument()
})
it('keeps unobserved usage unknown', () => {
  render(<ChatUsage events={[]} />)
  expect(screen.getByText('Usage not observed for this turn')).toBeInTheDocument()
})
