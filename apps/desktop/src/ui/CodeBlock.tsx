import { useState } from 'react'
import { textOf } from './reactText'
import { Check, Copy } from 'lucide-react'

/** Hover copy button shared by code blocks and diagrams. */
export function CopyButton({ text, title = 'Copy code' }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }, () => undefined)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="absolute top-2 right-2 z-10 p-1 rounded bg-muted/80 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      title={copied ? 'Copied' : title}
      aria-label={title}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

export function CodeBlock({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const language = className?.replace('hljs language-', '')?.replace('language-', '') ?? ''

  return (
    <div className="group relative">
      {language && (
        <span className="absolute top-2 left-3 text-[10px] uppercase text-muted-foreground/60 font-mono">
          {language}
        </span>
      )}
      <CopyButton text={textOf(children)} />
      <code className={className} {...props}>
        {children}
      </code>
    </div>
  )
}
