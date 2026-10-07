import { useMemo } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkBreaks from 'remark-breaks'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import { MermaidBlock } from './MermaidBlock'
import { CodeBlock } from './CodeBlock'
import { HtmlRenderFrame } from '@features/workspace/chat/html-render'
import { useAppStore } from '@core/store'
import 'katex/dist/katex.min.css'

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'details', 'summary', 'kbd', 'sub', 'sup', 'ins'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id', 'className'],
  },
}

function isCodeFenceClosed(content: string, rawHtml: string): boolean {
  if (!content) return true
  const fenceRegex = /```(?:orchestra-html|html-render|html-preview|html-visualization)[^\n]*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match[1].trim() === rawHtml.trim()) {
      return true
    }
  }
  return false
}

function StreamingVisualizationSkeleton() {
  return (
    <div
      data-testid="html-render-streaming"
      role="status"
      aria-label="Generating preview…"
      className="my-2.5 flex items-center gap-2 py-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150 select-none"
    >
      <span className="font-medium text-foreground/80">Generating preview…</span>
      <span className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-primary/70 animate-pulse" />
        <span className="size-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:200ms]" />
        <span className="size-1.5 rounded-full bg-primary/70 animate-pulse [animation-delay:400ms]" />
      </span>
    </div>
  )
}

const CUSTOM_WIDGET_LANGS = [
  'orchestra-html',
  'html-render',
  'html-preview',
  'html-visualization',
  'mermaid',
]

function isCustomWidgetBlock(node: any, children: any): boolean {
  if (node?.children && Array.isArray(node.children)) {
    for (const child of node.children) {
      const cls = child?.properties?.className
      const classList: string[] = Array.isArray(cls) ? cls : typeof cls === 'string' ? cls.split(/\s+/) : []
      for (const c of classList) {
        const match = /language-([a-zA-Z0-9_-]+)/.exec(c)
        if (match && CUSTOM_WIDGET_LANGS.includes(match[1])) return true
      }
    }
  }

  const childList = Array.isArray(children) ? children : [children]
  for (const child of childList) {
    if (child && typeof child === 'object' && 'props' in child) {
      const cls = (child as any).props?.className ?? ''
      const match = /language-([a-zA-Z0-9_-]+)/.exec(cls)
      if (match && CUSTOM_WIDGET_LANGS.includes(match[1])) return true

      const nodeCls = (child as any).props?.node?.properties?.className
      const classList: string[] = Array.isArray(nodeCls) ? nodeCls : typeof nodeCls === 'string' ? nodeCls.split(/\s+/) : []
      for (const c of classList) {
        const m = /language-([a-zA-Z0-9_-]+)/.exec(c)
        if (m && CUSTOM_WIDGET_LANGS.includes(m[1])) return true
      }
    }
  }

  return false
}

interface MarkdownRendererProps {
  content: string
  className?: string
  allowHtml?: boolean
  enableMermaid?: boolean
  enableMath?: boolean
  isStreaming?: boolean
  /** Override or extend the default react-markdown component map */
  components?: Components
  /** Extra remark plugins appended after the defaults */
  remarkPlugins?: any[]
  /** Extra rehype plugins appended after the defaults */
  rehypePlugins?: any[]
  /** When set, http(s) links open in the internal browser scoped to this project. */
  linkProjectId?: string
}

export function MarkdownRenderer({
  content,
  className = '',
  allowHtml = false,
  enableMermaid = true,
  enableMath = true,
  isStreaming = false,
  components: componentOverrides,
  remarkPlugins: extraRemarkPlugins,
  rehypePlugins: extraRehypePlugins,
  linkProjectId,
}: MarkdownRendererProps) {
  const theme = useAppStore((s) => s.theme)
  const openBrowserTab = useAppStore((s) => s.openBrowserTab)
  const setActiveSection = useAppStore((s) => s.setActiveSection)

  // Plugin arrays must be referentially stable so react-markdown doesn't tear
  // down its entire tree (and remount MermaidBlock) on every parent re-render.
  const remarkPlugins = useMemo(() => {
    const out: any[] = [remarkGfm, remarkBreaks]
    if (enableMath) out.push(remarkMath)
    if (extraRemarkPlugins) out.push(...extraRemarkPlugins)
    return out
  }, [enableMath, extraRemarkPlugins])

  const rehypePlugins = useMemo(() => {
    const out: any[] = [rehypeHighlight, rehypeSlug]
    if (enableMath) out.push(rehypeKatex)
    if (!allowHtml) out.push([rehypeSanitize, sanitizeSchema])
    if (extraRehypePlugins) out.push(...extraRehypePlugins)
    return out
  }, [enableMath, allowHtml, extraRehypePlugins])

  // Same reasoning for the components map: re-creating these functions on
  const mergedComponents = useMemo<Components>(() => {
    const defaults: Components = {
      pre({ children, className: cls, node, ...props }: any) {
        if (isCustomWidgetBlock(node, children)) {
          return <>{children}</>
        }
        return <pre className={`relative border-0 ${cls ?? ''}`.trim()} {...props}>{children}</pre>
      },
      code({ children, className: cls, node, ...props }: any) {
        const match = /language-([a-zA-Z0-9_-]+)/.exec(cls ?? '')
        const language = match?.[1] ?? ''
        const isInline = !node?.position || !cls

        if (isInline) {
          return <code className="bg-muted px-1.5 py-0.5 rounded text-sm" {...props}>{children}</code>
        }

        if (enableMermaid && language === 'mermaid') {
          return <MermaidBlock code={String(children).trim()} theme={theme} />
        }

        if (['orchestra-html', 'html-render', 'html-preview', 'html-visualization'].includes(language)) {
          const rawHtml = String(children).trim()
          const titleMatch = /<!--\s*title:\s*(.+?)\s*-->/i.exec(rawHtml) || /<h[12][^>]*>(.+?)<\/h[12]>/i.exec(rawHtml)
          const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Visualization'

          if (isStreaming) {
            const isClosed = isCodeFenceClosed(content, rawHtml)
            if (!isClosed) {
              return <StreamingVisualizationSkeleton />
            }
          }

          return (
            <HtmlRenderFrame
              htmlRender={{
                title,
                height: 500,
                html: rawHtml,
              }}
            />
          )
        }

        return (
          <CodeBlock className={cls} {...props}>
            {children}
          </CodeBlock>
        )
      },
      a({ href, children, ...props }: any) {
        const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href)
        if (!isExternal) {
          return <a href={href} {...props}>{children}</a>
        }
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              setActiveSection('CONSOLE')
              openBrowserTab(href, linkProjectId)
            }}
            {...props}
          >
            {children}
          </a>
        )
      },
    }
    return componentOverrides ? { ...defaults, ...componentOverrides } : defaults
  }, [enableMermaid, theme, componentOverrides, openBrowserTab, setActiveSection, linkProjectId, isStreaming, content])

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={mergedComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
