import { useCallback, useEffect, useState } from 'react'
import { fetchAgentProviderKeys } from '@core/api/client'
import type { BackendConfig } from '@core/api/client'
import { type ChatProviderConfig, CHAT_PROVIDERS } from '../lib/types'
import { fetchProviderModels, type ModelInfo } from '../lib/providers'

const PREFS_KEY = 'orchestra-agent-provider-prefs'

/** Preferred default models per provider — tried in order, falls back to first available. */
const PREFERRED_DEFAULTS: Record<string, string[]> = {
  openrouter: ['anthropic/claude-sonnet-4', 'openai/gpt-4o', 'google/gemini-2.5-flash'],
  openai: ['gpt-4o'],
  claude: ['claude-sonnet-4-6'],
  gemini: ['gemini-2.5-flash'],
}

/** Pick the best default model from a fetched list based on provider preferences. */
function pickDefaultModel(providerId: string, models: ModelInfo[]): string {
  const preferred = PREFERRED_DEFAULTS[providerId]
  if (preferred) {
    const modelById = new Map(models.map((m) => [m.id, m]))
    for (const id of preferred) {
      if (modelById.has(id)) return id
    }
  }
  return models[0].id
}

function loadPrefs(): { providerId?: string; modelId?: string } {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function savePrefs(providerId: string, modelId: string) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ providerId, modelId })) } catch { /* */ }
}

export function useProviderConfig(config: BackendConfig | null) {
  const [providerConfig, setProviderConfig] = useState<ChatProviderConfig>(() => {
    const prefs = loadPrefs()
    return {
      providerId: (prefs.providerId as ChatProviderConfig['providerId']) ?? 'openrouter',
      modelId: prefs.modelId ?? '',
      apiKey: '',
    }
  })
  const [availableKeys, setAvailableKeys] = useState<Record<string, string>>({})
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fetchCount, setFetchCount] = useState(0)

  // Fetch keys on mount AND whenever fetchCount bumps
  useEffect(() => {
    if (!config) return
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect
    fetchAgentProviderKeys(config)
      .then((result) => {
        const keys: Record<string, string> = {}
        for (const [id, info] of Object.entries(result.providers)) {
          if (info.configured && info.api_key) {
            keys[id] = info.api_key
          }
        }
        setAvailableKeys(keys)

        // Use saved prefs if the saved provider has a key, otherwise first configured
        const saved = loadPrefs()
        const savedProviderHasKey = saved.providerId && keys[saved.providerId]
        const targetProvider = savedProviderHasKey
          ? CHAT_PROVIDERS.find(p => p.id === saved.providerId)
          : CHAT_PROVIDERS.find(p => keys[p.id])
        if (targetProvider && keys[targetProvider.id]) {
          setProviderConfig({
            providerId: targetProvider.id,
            modelId: saved.modelId || '',
            apiKey: keys[targetProvider.id],
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [config, fetchCount])

  // Fetch models when provider or key changes
  useEffect(() => {
    const key = availableKeys[providerConfig.providerId]
    if (!key) {
      setModels([])
      return
    }

    let cancelled = false
    setModelsLoading(true)
    fetchProviderModels(providerConfig.providerId, key)
      .then((fetched) => {
        if (cancelled) return
        setModels(fetched)
        if (fetched.length > 0) {
          // Use saved model if it exists in the list, otherwise pick a smart default
          const saved = loadPrefs().modelId
          const match = saved && fetched.find(m => m.id === saved)
          const selectedId = match ? match.id : pickDefaultModel(providerConfig.providerId, fetched)
          setProviderConfig(prev => {
            if (!prev.modelId || !fetched.find(m => m.id === prev.modelId)) {
              return { ...prev, modelId: selectedId }
            }
            return prev
          })
        }
      })
      .catch(() => {
        if (!cancelled) setModels([])
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerConfig.providerId, availableKeys])

  const updateProvider = useCallback((providerId: ChatProviderConfig['providerId'], modelId?: string) => {
    const newModelId = modelId ?? ''
    savePrefs(providerId, newModelId)
    setProviderConfig({
      providerId,
      modelId: newModelId,
      apiKey: availableKeys[providerId] ?? '',
    })
  }, [availableKeys])

  // Call this to re-fetch keys from the backend (e.g. after settings change)
  const refetchKeys = useCallback(() => {
    setFetchCount(c => c + 1)
  }, [])

  return { providerConfig, setProviderConfig, updateProvider, availableKeys, models, modelsLoading, loading, refetchKeys }
}
