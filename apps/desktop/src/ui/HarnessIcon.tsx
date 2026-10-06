import { Bot } from 'lucide-react'

const icons: Record<string, { src: string; invert?: boolean }> = {
  codex: { src: './OpenAI_Symbol_1.png', invert: true },
  claude: { src: './Anthropic_Symbol_1.png', invert: true },
  gemini: { src: './Google_Symbol_1.png' },
  opencode: { src: './opencode.png' },
  antigravity: { src: './antigravity.png' },
  '8gent': { src: './8gent.png' },
}

export function HarnessIcon({ id, size = 16 }: { id: string; size?: number }) {
  const icon = icons[id.toLowerCase()]
  return icon
    ? <img src={icon.src} width={size} height={size} alt="" aria-hidden="true" className={`shrink-0 object-contain ${icon.invert ? 'dark:invert' : ''}`} />
    : <Bot aria-hidden="true" className="size-4 shrink-0" />
}
