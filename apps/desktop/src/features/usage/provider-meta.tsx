import type { QuotaProvider } from '@core/api/client'

export function providerLabel(provider: QuotaProvider): string {
  switch (provider) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    case 'gemini':
      return 'Gemini CLI (legacy logs)'
    case 'opencode':
      return 'OpenCode'
    case 'antigravity':
      return 'Antigravity'
    case '8gent':
      return '8gent'
  }
}

type ProviderIconMeta = { src: string; invert: boolean }

function providerIconMeta(provider: QuotaProvider): ProviderIconMeta {
  switch (provider) {
    case 'claude':
      return { src: './Anthropic_Symbol_1.png', invert: true }
    case 'codex':
      return { src: './OpenAI_Symbol_1.png', invert: true }
    case 'gemini':
      return { src: './Google_Symbol_1.png', invert: false }
    case 'opencode':
      return { src: './opencode.png', invert: false }
    case 'antigravity':
      return { src: './Google_Symbol_1.png', invert: false }
    case '8gent':
      return { src: './8gent.png', invert: false }
  }
}

export function ProviderIcon({ provider, size = 14 }: { provider: QuotaProvider; size?: number }) {
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
