/**
 * Agent-authored HTML pages ("HTML renders") are self-contained documents an
 * agent publishes into a thread with the `html_render` tool (or inline ```t3-html
 * code block). Clients show it in a sandboxed iframe with an opaque origin and
 * supply the active theme as CSS custom properties via the MCP Apps protocol.
 */

export const HTML_RENDER_TOOL_NAME = 'html_render'
export const HTML_RENDER_MIN_HEIGHT = 80
export const HTML_RENDER_MAX_HEIGHT = 2000
export const HTML_RENDER_MAX_TITLE_LENGTH = 200

/** What the `html_render` tool result carries so clients can show the page. */
export interface HtmlRenderReference {
  readonly attachmentId?: string
  readonly title: string
  /** The agent's frame height in CSS pixels, and the cap on any measured height. */
  readonly height: number
  /**
   * `[width, contentHeight]` pairs measured at publish, ascending by width.
   */
  readonly heights?: ReadonlyArray<readonly [width: number, height: number]>
  /** Inline HTML content when rendered directly without an external attachment store */
  readonly html?: string
}

/** Frame widths the server measures a page at, from phones to the wide chat setting. */
export const HTML_RENDER_MEASURE_WIDTHS = [320, 375, 430, 520, 640, 728, 860, 1000, 1144] as const

/**
 * The reply column's frame width at the default chat width. Agents preview at
 * it, and it picks the measured height when a client cannot know its width.
 */
export const HTML_RENDER_COLUMN_WIDTH = 728

const MAX_MEASURED_HEIGHTS = 24

export function clampHtmlRenderHeight(height: number): number {
  return Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, Math.round(height)))
}

function readMeasuredHeights(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MEASURED_HEIGHTS) {
    return undefined
  }
  const heights = value.flatMap((entry) =>
    Array.isArray(entry) &&
    entry.length === 2 &&
    Number.isInteger(entry[0]) &&
    entry[0] >= 1 &&
    entry[0] <= 10_000 &&
    typeof entry[1] === 'number' &&
    Number.isFinite(entry[1])
      ? [[entry[0] as number, clampHtmlRenderHeight(entry[1])] as const]
      : [],
  )
  return heights.length === value.length
    ? [...heights].sort((left, right) => left[0] - right[0])
    : undefined
}

export function readHtmlRenderReference(value: unknown): HtmlRenderReference | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { attachmentId, title, height, heights, html } = value as Record<string, unknown>
  if (
    (typeof attachmentId !== 'string' || attachmentId.length === 0) &&
    (typeof html !== 'string' || html.length === 0)
  ) {
    return undefined
  }
  if (typeof title !== 'string' || typeof height !== 'number' || !Number.isFinite(height)) {
    return undefined
  }
  const measured = readMeasuredHeights(heights)
  return {
    ...(typeof attachmentId === 'string' && attachmentId ? { attachmentId } : {}),
    ...(typeof html === 'string' && html ? { html } : {}),
    title: title.trim().slice(0, HTML_RENDER_MAX_TITLE_LENGTH) || 'HTML Visualization',
    height: clampHtmlRenderHeight(height),
    ...(measured === undefined ? {} : { heights: measured }),
  }
}

/** Whether two references show the same page at the same sizes. */
export function htmlRenderReferencesEqual(left: HtmlRenderReference, right: HtmlRenderReference): boolean {
  return (
    left.attachmentId === right.attachmentId &&
    left.title === right.title &&
    left.height === right.height &&
    left.html === right.html &&
    (left.heights ?? []).length === (right.heights ?? []).length &&
    (left.heights ?? []).every(
      ([width, height], index) =>
        right.heights?.[index]?.[0] === width && right.heights[index][1] === height,
    )
  )
}

function measuredHeight(heights: NonNullable<HtmlRenderReference['heights']>, width: number) {
  const above = heights.findIndex(([measuredWidth]) => measuredWidth >= width)
  const high = above === -1 ? heights.length - 1 : above
  const low = heights[high]![0] === width ? high : Math.max(0, high - 1)
  return Math.max(heights[low]![1], heights[high]![1])
}

/**
 * The frame height for a page at a frame width. It is the page's own reported
 * `contentHeight` when the client has one, else the server's measurement for
 * that width.
 */
export function htmlRenderFrameHeight(
  reference: HtmlRenderReference,
  width: number,
  contentHeight?: number,
): number {
  const heights = reference.heights
  if (heights === undefined || heights.length === 0) {
    return clampHtmlRenderHeight(contentHeight ?? reference.height)
  }
  const cap =
    measuredHeight(heights, HTML_RENDER_COLUMN_WIDTH) > reference.height
      ? reference.height
      : HTML_RENDER_MAX_HEIGHT
  return clampHtmlRenderHeight(Math.min(cap, contentHeight ?? measuredHeight(heights, width)))
}

/** A readable download name: the title without characters file systems reject. */
export function htmlRenderFileName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim()
  return `${name || 'visualization'}.html`
}

export interface HtmlRenderFonts {
  readonly sans: string
  readonly mono: string
}

export const HTML_RENDER_DEFAULT_FONTS: HtmlRenderFonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif',
  mono: '"JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
}

export interface HtmlRenderTheme {
  readonly appearance: 'light' | 'dark'
  readonly variables: Readonly<Record<string, string>>
}

// Built-in fixed roles and categorical chart series
const FIXED_CHART_COLORS = {
  light: {
    success: '#10b981',
    successForeground: '#047857',
    info: '#3b82f6',
    infoForeground: '#1d4ed8',
    chart: ['#0d9488', '#d97706', '#9333ea', '#e11d48', '#65a30d', '#2563eb'],
  },
  dark: {
    success: '#10b981',
    successForeground: '#34d399',
    info: '#3b82f6',
    infoForeground: '#60a5fa',
    chart: ['#2dd4bf', '#fbbf24', '#c084fc', '#fb7185', '#a3e635', '#38bdf8'],
  },
} as const

export function htmlRenderTheme(
  variables: Record<string, string>,
  appearance: 'light' | 'dark',
  fonts: HtmlRenderFonts = HTML_RENDER_DEFAULT_FONTS,
): HtmlRenderTheme {
  const fixed = FIXED_CHART_COLORS[appearance]
  return {
    appearance,
    variables: {
      '--background': variables['--background'] ?? (appearance === 'dark' ? '#0a0a0a' : '#fcfcfc'),
      '--foreground': variables['--foreground'] ?? (appearance === 'dark' ? '#f5f5f5' : '#27272a'),
      '--muted': variables['--muted'] ?? (appearance === 'dark' ? '#1a1a1a' : '#f4f4f5'),
      '--muted-foreground': variables['--muted-foreground'] ?? (appearance === 'dark' ? '#818181' : '#71717b'),
      '--card': variables['--card'] ?? (appearance === 'dark' ? '#111111' : '#ffffff'),
      '--card-foreground': variables['--card-foreground'] ?? (appearance === 'dark' ? '#f5f5f5' : '#27272a'),
      '--popover': variables['--popover'] ?? (appearance === 'dark' ? '#141414' : '#ffffff'),
      '--popover-foreground': variables['--popover-foreground'] ?? (appearance === 'dark' ? '#f5f5f5' : '#27272a'),
      '--secondary': variables['--secondary'] ?? (appearance === 'dark' ? '#1a1a1a' : '#f4f4f5'),
      '--secondary-foreground': variables['--secondary-foreground'] ?? (appearance === 'dark' ? '#f5f5f5' : '#27272a'),
      '--border': variables['--border'] ?? (appearance === 'dark' ? '#191919' : '#e4e4e7'),
      '--input': variables['--input'] ?? (appearance === 'dark' ? '#1e1e1e' : '#d4d4d8'),
      '--ring': variables['--ring'] ?? (appearance === 'dark' ? '#3b82f6' : '#2563eb'),
      '--primary': variables['--primary'] ?? (appearance === 'dark' ? '#3b82f6' : '#2563eb'),
      '--primary-foreground': variables['--primary-foreground'] ?? '#ffffff',
      '--accent': variables['--accent'] ?? (appearance === 'dark' ? '#3b82f6' : '#2563eb'),
      '--accent-foreground': variables['--accent-foreground'] ?? '#ffffff',
      '--destructive': variables['--destructive'] ?? '#ef4444',
      '--destructive-foreground': '#ffffff',
      '--warning': variables['--warning'] ?? '#f59e0b',
      '--warning-foreground': '#ffffff',
      '--success': fixed.success,
      '--success-foreground': fixed.successForeground,
      '--info': fixed.info,
      '--info-foreground': fixed.infoForeground,
      '--chart-1': variables['--chart-1'] ?? fixed.chart[0],
      '--chart-2': variables['--chart-2'] ?? fixed.chart[1],
      '--chart-3': variables['--chart-3'] ?? fixed.chart[2],
      '--chart-4': variables['--chart-4'] ?? fixed.chart[3],
      '--chart-5': variables['--chart-5'] ?? fixed.chart[4],
      '--chart-6': variables['--chart-6'] ?? fixed.chart[5],
      '--radius': '0.625rem',
      '--font-sans': fonts.sans,
      '--font-mono': fonts.mono,
    },
  }
}

/** Agent-facing reference for the injected variables, used in tool descriptions. */
export const HTML_RENDER_THEME_GUIDE = [
  'Orchestra injects its active theme as CSS custom properties on :root, and they follow the user theme and light/dark mode live:',
  '--background (page background, identical to the thread around the frame), --foreground, --muted, --muted-foreground,',
  '--card, --card-foreground, --popover, --popover-foreground, --secondary, --secondary-foreground, --border, --input, --ring,',
  '--primary, --primary-foreground (solid buttons), --accent, --accent-foreground (brand accent),',
  '--destructive, --destructive-foreground, --warning, --warning-foreground,',
  '--success, --success-foreground, --info, --info-foreground,',
  '--chart-1 … --chart-6 (categorical series for charts), --radius, --font-sans, --font-mono.',
  'The base stylesheet sets html background/color/font from these, body margin to 0, and hides the page scrollbar; your own CSS overrides it.',
].join(' ')

/** Agent-facing layout rules for a page that sits inside a reply. */
export const HTML_RENDER_LAYOUT_GUIDE = [
  `The frame is borderless on the thread background, as wide as the reply column (${HTML_RENDER_COLUMN_WIDTH}px on desktop by default), and its left edge lines up with your reply text.`,
  'Use a fluid width with no horizontal padding on the outermost element, and no outer card, border, or banner title: the page is part of your reply.',
  'Give charts fixed pixel heights rather than heights that scale with width.',
  'Let content set the page height. Avoid viewport-based heights such as 100vh or height:100% on html or body; the frame grows to fit the page, so they can make it grow again and again.',
].join(' ')

// MCP Apps Protocol Methods
export const HOST_CONTEXT_CHANGED_METHOD = 'ui/notifications/host-context-changed'
export const OPEN_LINK_METHOD = 'ui/open-link'
export const SIZE_CHANGED_METHOD = 'ui/notifications/size-changed'

/** The content height in a framed render's `ui/notifications/size-changed` notification. */
export function readHtmlRenderContentHeight(data: unknown): number | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { jsonrpc, method, params } = data as Record<string, unknown>
  if (jsonrpc !== '2.0' || method !== SIZE_CHANGED_METHOD) return undefined
  const height =
    typeof params === 'object' && params !== null
      ? (params as { height?: unknown }).height
      : undefined
  return typeof height === 'number' && Number.isFinite(height) && height > 0 ? height : undefined
}

/** A render's `ui/open-link` request, if `data` is one with an http(s) URL. */
export function readHtmlRenderLinkRequest(
  data: unknown,
): { readonly id: string | number; readonly url: string } | undefined {
  if (typeof data !== 'object' || data === null) return undefined
  const { jsonrpc, id, method, params } = data as Record<string, unknown>
  if (jsonrpc !== '2.0' || method !== OPEN_LINK_METHOD) return undefined
  if (typeof id !== 'string' && typeof id !== 'number') return undefined
  const url =
    typeof params === 'object' && params !== null ? (params as { url?: unknown }).url : undefined
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? { id, url } : undefined
}

/** The empty result a client sends back for a render's request. */
export function htmlRenderResult(id: string | number) {
  return { jsonrpc: '2.0', id, result: {} } as const
}

export const THEME_FRAGMENT_KEY = 't3-theme'

/** URL fragment that hands a render its theme before first paint. */
export function htmlRenderThemeFragment(theme: HtmlRenderTheme): string {
  return `#${THEME_FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify(theme))}`
}

/** The `host-context-changed` notification a client posts into a mounted render when the theme changes. */
export function htmlRenderThemeMessage(theme: HtmlRenderTheme) {
  return {
    jsonrpc: '2.0',
    method: HOST_CONTEXT_CHANGED_METHOD,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  } as const
}

const BASE_CSS =
  'html{background:var(--background);color:var(--foreground);font-family:var(--font-sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;scrollbar-width:none}' +
  'html::-webkit-scrollbar{display:none}body{margin:0}code,kbd,pre,samp{font-family:var(--font-mono)}'

function rootRule(theme: HtmlRenderTheme): string {
  const declarations = Object.entries(theme.variables)
    .map(([name, value]) => `${name}:${value};`)
    .join('')
  return `:root{color-scheme:${theme.appearance};${declarations}}`
}

export const BOOTSTRAP_SCRIPT = `(function(){var s=document.getElementById("t3-theme"),n=0;if(!s)return;var b=${JSON.stringify(BASE_CSS)};function a(t){if(!t||typeof t!=="object"||!t.variables||typeof t.variables!=="object")return;var c=":root{color-scheme:"+(t.appearance==="light"?"light":"dark")+";";for(var k in t.variables){if(/^--[a-z0-9-]+$/.test(k))c+=k+":"+String(t.variables[k]).replace(/[;{}<>]/g,"")+";";}s.textContent=c+"}"+b;}try{var m=/[#&]${THEME_FRAGMENT_KEY}=([^&]*)/.exec(location.hash);if(m){a(JSON.parse(decodeURIComponent(m[1])));history.replaceState(history.state,"",location.pathname+location.search);}}catch(e){}window.addEventListener("message",function(e){var d=e.data,p=d&&d.params;if(d&&d.jsonrpc==="2.0"&&d.method===${JSON.stringify(HOST_CONTEXT_CHANGED_METHOD)}&&p&&p.styles)a({appearance:p.theme,variables:p.styles.variables});});document.addEventListener("click",function(e){var l=e.isTrusted?e.composedPath().find(function(t){return t&&t.matches&&t.matches("a[href]");}):null,u;if(!l)return;try{u=new URL(l.getAttribute("href"),document.baseURI);}catch(x){return;}if(!/^https?:$/.test(u.protocol)||u.href.split("#")[0]===location.href.split("#")[0])return;if(window.parent!==window){e.preventDefault();window.parent.postMessage({jsonrpc:"2.0",id:"t3-link-"+(++n),method:${JSON.stringify(OPEN_LINK_METHOD)},params:{url:u.href}},"*");}else{l.setAttribute("target","_blank");l.setAttribute("rel","noopener");}},true);if(window.parent!==window){var h,o,z=function(){var r=document.documentElement,v=Math.ceil(r.scrollHeight>r.clientHeight?r.scrollHeight:r.getBoundingClientRect().height);if(v===h)return;h=v;window.parent.postMessage({jsonrpc:"2.0",method:${JSON.stringify(SIZE_CHANGED_METHOD)},params:{height:v}},"*");};if(window.ResizeObserver){o=new ResizeObserver(z);o.observe(document.documentElement);}document.addEventListener("DOMContentLoaded",function(){if(o&&document.body)o.observe(document.body);z();});window.addEventListener("load",z);}})();`

function bootstrapMarkup(markup: string, theme?: HtmlRenderTheme): string {
  const dark = htmlRenderTheme({}, 'dark')
  const light = htmlRenderTheme({}, 'light')
  const activeCss = theme ? rootRule(theme) : `${rootRule(dark)}@media (prefers-color-scheme: light){${rootRule(light)}}`
  const defaultCss = `${activeCss}${BASE_CSS}`
  return [
    /<meta\s[^>]*charset/i.test(markup.slice(0, 4096)) ? '' : '<meta charset="utf-8">',
    /<meta\s[^>]*name\s*=\s*["']?viewport/i.test(markup)
      ? ''
      : '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="t3-theme">${defaultCss}</style>`,
    `<script>${BOOTSTRAP_SCRIPT}</script>`,
  ].join('')
}

const blankNonMarkup = (html: string) => {
  const scan = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript)\b[\s\S]*?(?:<\/\1\s*>|$)|<plaintext\b[\s\S]*$/gi,
    (match) => ' '.repeat(match.length),
  )
  const parts: string[] = []
  let depth = 0
  let start = 0
  let at = 0
  for (const match of scan.matchAll(/<(\/?)template(?:\s[^>]*)?\/?>/gi)) {
    if (!match[1]) {
      if (depth++ === 0) start = match.index ?? 0
    } else if (depth > 0 && --depth === 0) {
      const end = (match.index ?? 0) + match[0].length
      parts.push(scan.slice(at, start), ' '.repeat(end - start))
      at = end
    }
  }
  if (depth > 0) {
    parts.push(scan.slice(at, start), ' '.repeat(scan.length - start))
    at = scan.length
  }
  parts.push(scan.slice(at))
  return parts.join('')
}

/**
 * Inserts the theme bootstrap at the start of the document head, so a page's
 * own styles and scripts come after it.
 */
export function injectHtmlRenderBootstrap(html: string, theme?: HtmlRenderTheme): string {
  const scan = blankNonMarkup(html)
  const markup = bootstrapMarkup(scan, theme)
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(scan)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return html.slice(0, at) + markup + html.slice(at)
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(scan)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) {
    const at = doctype[0].length
    return `${html.slice(0, at)}<head>${markup}</head>${html.slice(at)}`
  }
  return `<!doctype html><head>${markup}</head>${html}`
}

/** The page a completed `html_render` tool call published, if this item is one. */
export function htmlRenderFromToolItem(item: {
  readonly toolName?: string | null
  readonly output?: unknown
}): HtmlRenderReference | undefined {
  const tool = String(item.toolName ?? '').toLowerCase()
  if (tool !== HTML_RENDER_TOOL_NAME && !tool.endsWith(':html_render') && !tool.endsWith('/html_render')) {
    return undefined
  }
  if (typeof item.output === 'object' && item.output !== null) {
    const record = item.output as Record<string, unknown>
    if (record.htmlRender) {
      return readHtmlRenderReference(record.htmlRender)
    }
    return readHtmlRenderReference(record)
  }
  if (typeof item.output === 'string') {
    try {
      const parsed = JSON.parse(item.output)
      return readHtmlRenderReference(parsed.htmlRender ?? parsed)
    } catch {
      // not JSON
    }
  }
  return undefined
}

/** Extracts an HtmlRenderReference from a turn's events if an html_render tool call was executed */
export function extractHtmlRenderFromEvents(events: ReadonlyArray<{
  readonly type?: string
  readonly payload?: unknown
}>): HtmlRenderReference | undefined {
  for (const event of events) {
    if (event.type === 'item/toolCall/completed' && typeof event.payload === 'object' && event.payload !== null) {
      const render = htmlRenderFromToolItem(event.payload as { toolName?: string; output?: unknown })
      if (render) return render
    }
  }
  return undefined
}

/** Extracts an inline ```t3-html, ```orchestra-html, or ```html-visualization code block from message text */
export function extractHtmlRenderFromContent(content: string): {
  readonly htmlRender: HtmlRenderReference
  readonly cleanedText: string
} | undefined {
  if (!content) return undefined
  const fenceRegex = /```(?:t3-html|orchestra-html|html-preview|html-visualization)(?:[^\n]*\n)([\s\S]*?)```/i
  const match = fenceRegex.exec(content)
  if (!match) return undefined
  const rawHtml = match[1].trim()
  if (!rawHtml) return undefined

  // Extract optional title from comment or first h1/h2 or fallback
  const titleMatch = /<!--\s*title:\s*(.+?)\s*-->/i.exec(rawHtml) || /<h[12][^>]*>(.+?)<\/h[12]>/i.exec(rawHtml)
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : 'Visualization'

  const htmlRender: HtmlRenderReference = {
    title,
    height: 500,
    html: rawHtml,
  }

  const cleanedText = content.replace(fenceRegex, '').trim()
  return { htmlRender, cleanedText }
}
