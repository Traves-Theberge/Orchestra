import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

/**
 * Creates an AI SDK provider instance for the given provider ID.
 * API keys are explicitly passed — never read from environment variables.
 */
export function createProvider(providerId: string, apiKey: string) {
  if (!apiKey) throw new Error(`No API key provided for ${providerId}`)

  switch (providerId) {
    case 'openrouter': {
      // OpenRouter only supports Chat Completions API, not the Responses API
      const or = createOpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey })
      return (modelId: string) => or.chat(modelId)
    }
    case 'openai': {
      // Use chat() for broad compatibility (Responses API is newer and not all models support it)
      const oai = createOpenAI({ apiKey })
      return (modelId: string) => oai.chat(modelId)
    }
    case 'claude':
      return createAnthropic({ apiKey })
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })
    default:
      throw new Error(`Unknown provider: ${providerId}`)
  }
}

export type ModelInfo = {
  id: string
  name: string
}

// Anthropic has no list-models API — these are the known chat models
const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
]

/**
 * Fetches available models from the provider's API.
 * Falls back to a static list if the API is unavailable.
 */
export async function fetchProviderModels(providerId: string, apiKey: string): Promise<ModelInfo[]> {
  if (!apiKey) return []

  try {
    switch (providerId) {
      case 'openai':
        return await fetchOpenAIModels('https://api.openai.com/v1/models', apiKey)
      case 'openrouter':
        return await fetchOpenRouterModels()
      case 'claude':
        return ANTHROPIC_MODELS
      case 'gemini':
        return await fetchGeminiModels(apiKey)
      default:
        return []
    }
  } catch (err) {
    throw new Error(`Failed to fetch models for ${providerId}: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
  }
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch(baseUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(httpErrorMessage(res.status))
  const data = await res.json() as { data: { id: string; owned_by?: string }[] }
  const filtered: ModelInfo[] = []
  const excludedTokens = new Set(['instruct', 'realtime', 'audio', 'tts', 'dall-e', 'whisper', 'embedding'])
  for (const m of data.data) {
    const id = m.id
    if (!(id.startsWith('gpt-') || id.startsWith('o'))) continue
    let skip = false
    for (const tok of excludedTokens) {
      if (id.includes(tok)) {
        skip = true
        break
      }
    }
    if (skip) continue
    filtered.push({ id, name: id })
  }
  return filtered.toSorted((a, b) => a.id.localeCompare(b.id))
}

async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(httpErrorMessage(res.status))
  const data = await res.json() as { data: { id: string; name: string; supported_parameters?: string[] }[] }
  return data.data
    .flatMap((m) => m.supported_parameters?.includes('tools') ? [{ id: m.id, name: m.name || m.id }] : [])
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
  if (!res.ok) throw new Error(httpErrorMessage(res.status))
  const data = await res.json() as { models: { name: string; displayName: string; supportedGenerationMethods?: string[] }[] }
  return data.models
    .flatMap((m) => m.supportedGenerationMethods?.includes('generateContent') ? [{
      id: m.name.replace('models/', ''),
      name: m.displayName || m.name.replace('models/', ''),
    }] : [])
    .toSorted((a, b) => a.name.localeCompare(b.name))
}

function httpErrorMessage(status: number): string {
  switch (status) {
    case 401: return 'Invalid API key — check that the key is correct and active'
    case 403: return 'Access denied — your API key does not have permission for this resource'
    case 429: return 'Rate limited — too many requests, try again in a moment'
    default: return `Request failed (HTTP ${status})`
  }
}

