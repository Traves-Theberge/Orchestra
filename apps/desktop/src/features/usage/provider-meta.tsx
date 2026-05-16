import type { UsageProvider } from '@core/api/client'

export function providerLabel(provider: UsageProvider): string {
  switch (provider) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'gemini':
      return 'Gemini'
    case 'opencode':
      return 'OpenCode'
  }
}

type ProviderIconMeta = { src: string; invert: boolean }

function providerIconMeta(provider: UsageProvider): ProviderIconMeta {
  switch (provider) {
    case 'claude':
      return { src: '/Anthropic_Symbol_1.png', invert: true }
    case 'codex':
      return { src: '/OpenAI_Symbol_1.png', invert: true }
    case 'gemini':
      return { src: '/Google_Symbol_1.png', invert: false }
    case 'opencode':
      return { src: '/opencode.png', invert: false }
  }
}

export function ProviderIcon({ provider, size = 14 }: { provider: UsageProvider; size?: number }) {
  const { src, invert } = providerIconMeta(provider)
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={providerLabel(provider)}
      className={`rounded-sm object-contain ${invert ? 'dark:invert' : ''}`}
    />
  )
}
