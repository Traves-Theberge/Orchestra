/**
 * Semantic role tokens. Components read CSS vars (`--background`, `--card`,
 * etc.) which are derived from these roles. Users edit roles, not raw vars.
 */

export type ThemeMode = 'light' | 'dark' | 'auto'
type ThemeDensityPreset = 'compact' | 'cozy' | 'comfortable'
type ThemeRadiusScale = 'sharp' | 'default' | 'rounded' | 'pill'
type ThemeShadowStrength = 'none' | 'subtle' | 'default' | 'strong'

/**
 * Each value is an HSL triple "H S% L%" so it can be dropped into
 * `hsl(var(--token))` directly (matching how Tailwind v4 reads the vars).
 */
export type RoleSet = {
  background: string       // page bg
  surface: string          // cards / panels (drives --card, --secondary, --accent)
  surfaceRaised: string    // popovers, dialogs, dropdowns (drives --popover)
  surfaceSunken: string    // inputs, inner panels (drives --muted)
  border: string           // default strokes
  borderStrong: string     // emphasized strokes
  text: string             // primary text (drives --foreground / *-foreground siblings)
  textMuted: string        // secondary text
  accent: string           // brand / active state (drives --primary / --ring)
  accentForeground: string // text on accent
  success: string          // done / online
  warning: string          // pending / caution
  error: string            // errors / delete (drives --destructive)
}

export type ChartPalette = [string, string, string, string, string]

export type ThemeTypography = {
  fontSans: string
  fontMono: string
  baseSizePx: number
  lineHeight: number
  headingScale: number
  letterSpacing: {
    bodyEm: number
    headingEm: number
    codeEm: number
  }
  fontWeight: {
    body: number
    medium: number
    strong: number
    heading: number
    code: number
  }
}

export type ThemeDensity = {
  preset: ThemeDensityPreset
  spacingScale: number
  controlHeight: {
    sm: number
    md: number
    lg: number
  }
  borderWidthPx: number
}

export type ThemeRadii = {
  scale: ThemeRadiusScale
  smRem: number
  mdRem: number
  lgRem: number
  xlRem: number
}

export type ThemeShadows = {
  strength: ThemeShadowStrength
  surface: string
  overlay: string
}

export type ThemeMotion = {
  scale: number
  reduceMotion: boolean
  backdropBlurPx: number
  durationMs: {
    fast: number
    base: number
    slow: number
  }
}

export type Theme = {
  id: string
  name: string
  builtin: boolean
  mode: ThemeMode
  /** Optional tone seed — when present, roles can be regenerated from it. */
  tone?: { hue: number; saturation: number }
  /** Resolved role values per concrete mode. `auto` uses dark when system dark. */
  roles: { light: RoleSet; dark: RoleSet }
  charts?: { light: ChartPalette; dark: ChartPalette }
  typography?: ThemeTypography
  density?: ThemeDensity
  radii?: ThemeRadii
  shadows?: ThemeShadows
  motion?: ThemeMotion
  createdAt?: string
  updatedAt?: string
}

export type ThemeRoleKey = keyof RoleSet
