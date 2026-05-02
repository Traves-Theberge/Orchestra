import { useState, useEffect, useCallback, useRef } from 'react'
import type { BackendConfig } from '@core/api/client'
import { fetchState } from '@core/api/client'

export type ContextSuggestion = {
  id: string
  text: string
  action: string
  params?: Record<string, unknown>
  dismissed: boolean
}

const STORAGE_KEY = 'orchestra-context-suggestions-enabled'
const COOLDOWN_MS = 15_000 // 15s between suggestion generations

/**
 * Hook that observes the current UI section and generates proactive
 * suggestions based on context. Suggestions are dismissible chips
 * displayed at the top of the chat panel.
 */
export function useContextSuggestions(
  config: BackendConfig | null,
  activeSection: string,
  selectedIssueId?: string,
  selectedProjectId?: string,
  isPanelOpen = false,
) {
  const [suggestions, setSuggestions] = useState<ContextSuggestion[]>([])
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const lastGenerationRef = useRef<number>(0)
  const lastSectionRef = useRef<string>('')

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const dismiss = useCallback((id: string) => {
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, dismissed: true } : s)))
  }, [])

  const dismissAll = useCallback(() => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, dismissed: true })))
  }, [])

  useEffect(() => {
    if (!enabled || !config || !isPanelOpen) return
    if (activeSection === lastSectionRef.current) return

    const now = Date.now()
    if (now - lastGenerationRef.current < COOLDOWN_MS) return

    lastSectionRef.current = activeSection
    lastGenerationRef.current = now

    const generateSuggestions = async () => {
      const newSuggestions: ContextSuggestion[] = []
      const mkId = () => `suggest-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

      try {
        switch (activeSection.toUpperCase()) {
          case 'ISSUES': {
            const state = await fetchState(config)
            const retrying = state.retrying?.length || 0
            const running = state.running?.length || 0
            if (retrying > 0) {
              newSuggestions.push({
                id: mkId(),
                text: `${retrying} retrying issue${retrying !== 1 ? 's' : ''} — want me to investigate?`,
                action: 'send_chat',
                params: { message: 'Show me all retrying issues and explain what went wrong' },
                dismissed: false,
              })
            }
            if (running > 0) {
              newSuggestions.push({
                id: mkId(),
                text: `${running} active session${running !== 1 ? 's' : ''} running`,
                action: 'send_chat',
                params: { message: 'Give me a status update on all running sessions' },
                dismissed: false,
              })
            }
            break
          }

          case 'WAREHOUSE': {
            newSuggestions.push({
              id: mkId(),
              text: 'Want a token usage breakdown by provider?',
              action: 'send_chat',
              params: { message: 'Show me warehouse stats with a breakdown by provider' },
              dismissed: false,
            })
            break
          }

          case 'PROJECTS': {
            if (selectedProjectId) {
              newSuggestions.push({
                id: mkId(),
                text: 'View git status for this project?',
                action: 'send_chat',
                params: { message: `Show me the git status and recent commits for project ${selectedProjectId}` },
                dismissed: false,
              })
            }
            break
          }

          case 'SETTINGS': {
            newSuggestions.push({
              id: mkId(),
              text: 'Need help configuring an integration?',
              action: 'send_chat',
              params: { message: 'What integrations are available and how do I configure them?' },
              dismissed: false,
            })
            break
          }

          case 'SANDBOX': {
            newSuggestions.push({
              id: mkId(),
              text: 'Run a quick code snippet?',
              action: 'send_chat',
              params: { message: 'Check if the Unsandbox environment is configured and ready' },
              dismissed: false,
            })
            break
          }
        }
      } catch {
        // Silently fail — suggestions are non-critical
      }

      if (newSuggestions.length > 0) {
        setSuggestions(newSuggestions)
      }
    }

    void generateSuggestions()
  }, [enabled, config, isPanelOpen, activeSection, selectedProjectId])

  const visibleSuggestions = suggestions.filter((s) => !s.dismissed)

  return {
    suggestions: visibleSuggestions,
    enabled,
    toggle,
    dismiss,
    dismissAll,
  }
}
