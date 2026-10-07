import { useMemo } from 'react'
import { useAppStore } from '@core/store'
import { resolveMode } from '@core/theme/apply'
import { findBuiltin, normalizeTheme } from '@core/theme/defaults'
import {
  htmlRenderTheme,
  HTML_RENDER_DEFAULT_FONTS,
  type HtmlRenderTheme,
} from './htmlRender'

function formatCssColor(val: string): string {
  const trimmed = val.trim()
  if (!trimmed) return ''
  // If it's already a full CSS color (hex, rgb, rgba, hsl, oklch)
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('rgb(') ||
    trimmed.startsWith('rgba(') ||
    trimmed.startsWith('hsl(') ||
    trimmed.startsWith('hsla(') ||
    trimmed.startsWith('oklch(')
  ) {
    return trimmed
  }
  // If it's HSL space-separated or comma-separated values like "240 10% 4%" or "240, 10%, 4%"
  if (/^[\d.]+\s+[\d.]+%?\s+[\d.]+%?/.test(trimmed) || /^[\d.]+,\s*[\d.]+%?,\s*[\d.]+%?/.test(trimmed)) {
    return `hsl(${trimmed})`
  }
  return trimmed
}

/**
 * Resolves the app's active theme into CSS variables suitable for the
 * sandboxed HTML render iframe.
 */
export function useHtmlRenderTheme(): HtmlRenderTheme {
  const activeThemeId = useAppStore((s) => s.activeThemeId)
  const modeOverride = useAppStore((s) => s.modeOverride)
  const builtinThemes = useAppStore((s) => s.builtinThemes)
  const customThemes = useAppStore((s) => s.customThemes)

  return useMemo(() => {
    const allThemes = [...builtinThemes, ...customThemes]
    const theme = allThemes.find((t) => t.id === activeThemeId) ?? findBuiltin(activeThemeId)
    const normalized = theme ? normalizeTheme(theme) : undefined
    const appearance = resolveMode(modeOverride ?? normalized?.mode ?? 'dark')

    const root = typeof document !== 'undefined' ? document.documentElement : null
    const computed = root ? getComputedStyle(root) : null

    const getVar = (name: string, fallback = ''): string => {
      const computedVal = computed?.getPropertyValue(name)?.trim()
      if (computedVal) return formatCssColor(computedVal)
      return fallback
    }

    // Role-based fallbacks from normalized theme if DOM isn't ready
    const roles = normalized?.roles?.[appearance]
    const charts = normalized?.charts?.[appearance]

    const baseVariables: Record<string, string> = {
      '--background': getVar('--background', roles?.background ? formatCssColor(roles.background) : (appearance === 'dark' ? '#0a0a0a' : '#fcfcfc')),
      '--foreground': getVar('--foreground', roles?.text ? formatCssColor(roles.text) : (appearance === 'dark' ? '#f5f5f5' : '#27272a')),
      '--muted': getVar('--muted', roles?.surfaceSunken ? formatCssColor(roles.surfaceSunken) : (appearance === 'dark' ? '#1a1a1a' : '#f4f4f5')),
      '--muted-foreground': getVar('--muted-foreground', roles?.textMuted ? formatCssColor(roles.textMuted) : (appearance === 'dark' ? '#818181' : '#71717b')),
      '--card': getVar('--card', roles?.surface ? formatCssColor(roles.surface) : (appearance === 'dark' ? '#111111' : '#ffffff')),
      '--card-foreground': getVar('--card-foreground', roles?.text ? formatCssColor(roles.text) : (appearance === 'dark' ? '#f5f5f5' : '#27272a')),
      '--popover': getVar('--popover', roles?.surfaceRaised ? formatCssColor(roles.surfaceRaised) : (appearance === 'dark' ? '#141414' : '#ffffff')),
      '--popover-foreground': getVar('--popover-foreground', roles?.text ? formatCssColor(roles.text) : (appearance === 'dark' ? '#f5f5f5' : '#27272a')),
      '--secondary': getVar('--secondary', roles?.surface ? formatCssColor(roles.surface) : (appearance === 'dark' ? '#1a1a1a' : '#f4f4f5')),
      '--secondary-foreground': getVar('--secondary-foreground', roles?.text ? formatCssColor(roles.text) : (appearance === 'dark' ? '#f5f5f5' : '#27272a')),
      '--border': getVar('--border', roles?.border ? formatCssColor(roles.border) : (appearance === 'dark' ? '#191919' : '#e4e4e7')),
      '--input': getVar('--input', roles?.border ? formatCssColor(roles.border) : (appearance === 'dark' ? '#1e1e1e' : '#d4d4d8')),
      '--ring': getVar('--ring', roles?.accent ? formatCssColor(roles.accent) : (appearance === 'dark' ? '#3b82f6' : '#2563eb')),
      '--primary': getVar('--primary', roles?.accent ? formatCssColor(roles.accent) : (appearance === 'dark' ? '#3b82f6' : '#2563eb')),
      '--primary-foreground': getVar('--primary-foreground', roles?.accentForeground ? formatCssColor(roles.accentForeground) : '#ffffff'),
      '--accent': getVar('--accent', roles?.accent ? formatCssColor(roles.accent) : (appearance === 'dark' ? '#3b82f6' : '#2563eb')),
      '--accent-foreground': getVar('--accent-foreground', roles?.accentForeground ? formatCssColor(roles.accentForeground) : '#ffffff'),
      '--destructive': getVar('--destructive', roles?.error ? formatCssColor(roles.error) : '#ef4444'),
      '--destructive-foreground': '#ffffff',
      '--warning': getVar('--warning', roles?.warning ? formatCssColor(roles.warning) : '#f59e0b'),
      '--warning-foreground': '#ffffff',
      '--success': getVar('--success', roles?.success ? formatCssColor(roles.success) : '#10b981'),
      '--chart-1': getVar('--chart-1', charts?.[0] ? formatCssColor(charts[0]) : ''),
      '--chart-2': getVar('--chart-2', charts?.[1] ? formatCssColor(charts[1]) : ''),
      '--chart-3': getVar('--chart-3', charts?.[2] ? formatCssColor(charts[2]) : ''),
      '--chart-4': getVar('--chart-4', charts?.[3] ? formatCssColor(charts[3]) : ''),
      '--chart-5': getVar('--chart-5', charts?.[4] ? formatCssColor(charts[4]) : ''),
    }

    const fonts = {
      sans: normalized?.typography?.fontSans || HTML_RENDER_DEFAULT_FONTS.sans,
      mono: normalized?.typography?.fontMono || HTML_RENDER_DEFAULT_FONTS.mono,
    }

    return htmlRenderTheme(baseVariables, appearance, fonts)
  }, [activeThemeId, modeOverride, builtinThemes, customThemes])
}
