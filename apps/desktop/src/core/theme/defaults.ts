import type {
  ChartPalette,
  RoleSet,
  Theme,
  ThemeDensity,
  ThemeMotion,
  ThemeRadii,
  ThemeShadows,
  ThemeTypography,
} from './types'
import { deriveRoles } from './derive-surface'

export type NormalizedTheme = Theme & {
  charts: { light: ChartPalette; dark: ChartPalette }
  typography: ThemeTypography
  density: ThemeDensity
  radii: ThemeRadii
  shadows: ThemeShadows
  motion: ThemeMotion
}

const DEFAULT_CHART_DARK: ChartPalette = [
  '161 72% 45%',
  '280 65% 60%',
  '200 80% 55%',
  '340 70% 60%',
  '30 85% 60%',
]
const DEFAULT_CHART_LIGHT: ChartPalette = [
  '230 60% 55%',
  '280 55% 55%',
  '200 70% 50%',
  '340 65% 55%',
  '30 80% 55%',
]

const DEFAULT_THEME_TYPOGRAPHY: ThemeTypography = {
  fontSans: '"IBM Plex Sans", "Inter", "Segoe UI", sans-serif',
  fontMono: '"JetBrains Mono", "Fira Code", "SFMono-Regular", monospace',
  baseSizePx: 14,
  lineHeight: 1.5,
  headingScale: 1.25,
  letterSpacing: {
    bodyEm: 0,
    headingEm: -0.015,
    codeEm: -0.01,
  },
  fontWeight: {
    body: 450,
    medium: 500,
    strong: 600,
    heading: 700,
    code: 500,
  },
}

const DEFAULT_THEME_DENSITY: ThemeDensity = {
  preset: 'cozy',
  spacingScale: 1,
  controlHeight: {
    sm: 32,
    md: 36,
    lg: 44,
  },
  borderWidthPx: 1,
}

const DEFAULT_THEME_RADII: ThemeRadii = {
  scale: 'default',
  smRem: 0.375,
  mdRem: 0.5,
  lgRem: 0.75,
  xlRem: 1,
}

const DEFAULT_THEME_SHADOWS: ThemeShadows = {
  strength: 'default',
  surface: '0 8px 24px rgba(0, 0, 0, 0.08)',
  overlay: '0 18px 48px rgba(0, 0, 0, 0.18)',
}

const DEFAULT_THEME_MOTION: ThemeMotion = {
  scale: 1,
  reduceMotion: false,
  backdropBlurPx: 16,
  durationMs: {
    fast: 150,
    base: 250,
    slow: 400,
  },
}

function cloneTypography(): ThemeTypography {
  return {
    ...DEFAULT_THEME_TYPOGRAPHY,
    letterSpacing: { ...DEFAULT_THEME_TYPOGRAPHY.letterSpacing },
    fontWeight: { ...DEFAULT_THEME_TYPOGRAPHY.fontWeight },
  }
}

function cloneDensity(): ThemeDensity {
  return {
    ...DEFAULT_THEME_DENSITY,
    controlHeight: { ...DEFAULT_THEME_DENSITY.controlHeight },
  }
}

function cloneRadii(): ThemeRadii {
  return { ...DEFAULT_THEME_RADII }
}

function cloneShadows(): ThemeShadows {
  return { ...DEFAULT_THEME_SHADOWS }
}

function cloneMotion(): ThemeMotion {
  return {
    ...DEFAULT_THEME_MOTION,
    durationMs: { ...DEFAULT_THEME_MOTION.durationMs },
  }
}

export function normalizeTheme(theme: Theme): NormalizedTheme {
  return {
    ...theme,
    charts: theme.charts ?? { light: DEFAULT_CHART_LIGHT, dark: DEFAULT_CHART_DARK },
    typography: {
      ...cloneTypography(),
      ...theme.typography,
      letterSpacing: {
        ...cloneTypography().letterSpacing,
        ...theme.typography?.letterSpacing,
      },
      fontWeight: {
        ...cloneTypography().fontWeight,
        ...theme.typography?.fontWeight,
      },
    },
    density: {
      ...cloneDensity(),
      ...theme.density,
      controlHeight: {
        ...cloneDensity().controlHeight,
        ...theme.density?.controlHeight,
      },
    },
    radii: {
      ...cloneRadii(),
      ...theme.radii,
    },
    shadows: {
      ...cloneShadows(),
      ...theme.shadows,
    },
    motion: {
      ...cloneMotion(),
      ...theme.motion,
      durationMs: {
        ...cloneMotion().durationMs,
        ...theme.motion?.durationMs,
      },
    },
  }
}

function mk(
  id: string,
  name: string,
  light: RoleSet,
  dark: RoleSet,
  opts: { tone?: { hue: number; saturation: number }; charts?: Theme['charts'] } = {},
): Theme {
  return normalizeTheme({
    id,
    name,
    builtin: true,
    mode: 'auto',
    tone: opts.tone,
    roles: { light, dark },
    charts: opts.charts ?? { light: DEFAULT_CHART_LIGHT, dark: DEFAULT_CHART_DARK },
  })
}

// Orchestra Default — derived from the existing (160, 10) tone in index.css.
const orchestraDark: RoleSet = deriveRoles(160, 10, 'dark')
const orchestraLight: RoleSet = deriveRoles(160, 10, 'light')

// Nord — cool blue palette
const nordDark: RoleSet = {
  background: '220 16% 18%',
  surface: '220 16% 22%',
  surfaceRaised: '220 16% 26%',
  surfaceSunken: '220 16% 14%',
  border: '220 14% 32%',
  borderStrong: '220 14% 40%',
  text: '218 27% 92%',
  textMuted: '219 14% 65%',
  accent: '210 34% 63%',
  accentForeground: '220 16% 18%',
  success: '92 28% 65%',
  warning: '40 71% 73%',
  error: '354 42% 56%',
}
const nordLight: RoleSet = {
  background: '218 27% 94%',
  surface: '0 0% 100%',
  surfaceRaised: '0 0% 100%',
  surfaceSunken: '218 27% 88%',
  border: '218 22% 80%',
  borderStrong: '218 22% 70%',
  text: '220 16% 22%',
  textMuted: '219 14% 38%',
  accent: '210 34% 50%',
  accentForeground: '0 0% 100%',
  success: '92 28% 38%',
  warning: '40 71% 45%',
  error: '354 42% 46%',
}

// Dracula — purple/pink/cyan
const draculaDark: RoleSet = {
  background: '231 15% 18%',
  surface: '232 14% 22%',
  surfaceRaised: '232 14% 26%',
  surfaceSunken: '231 15% 14%',
  border: '232 14% 30%',
  borderStrong: '232 14% 38%',
  text: '60 30% 96%',
  textMuted: '225 12% 70%',
  accent: '265 89% 78%',
  accentForeground: '231 15% 18%',
  success: '135 94% 65%',
  warning: '31 100% 71%',
  error: '0 100% 67%',
}
const draculaLight: RoleSet = {
  background: '60 24% 96%',
  surface: '0 0% 100%',
  surfaceRaised: '0 0% 100%',
  surfaceSunken: '60 14% 90%',
  border: '60 10% 80%',
  borderStrong: '60 10% 70%',
  text: '231 15% 22%',
  textMuted: '225 12% 40%',
  accent: '265 60% 50%',
  accentForeground: '0 0% 100%',
  success: '135 50% 38%',
  warning: '31 80% 48%',
  error: '0 70% 50%',
}

// Solarized — Ethan Schoonover's palette
const solarizedDark: RoleSet = {
  background: '192 100% 11%',
  surface: '192 81% 14%',
  surfaceRaised: '193 43% 18%',
  surfaceSunken: '192 95% 9%',
  border: '194 25% 26%',
  borderStrong: '194 25% 36%',
  text: '44 87% 94%',
  textMuted: '180 7% 60%',
  accent: '205 82% 53%',
  accentForeground: '192 100% 11%',
  success: '68 100% 30%',
  warning: '45 100% 35%',
  error: '1 71% 52%',
}
const solarizedLight: RoleSet = {
  background: '44 87% 94%',
  surface: '46 42% 88%',
  surfaceRaised: '46 42% 92%',
  surfaceSunken: '46 42% 84%',
  border: '46 22% 78%',
  borderStrong: '46 22% 68%',
  text: '192 100% 17%',
  textMuted: '194 14% 40%',
  accent: '205 82% 45%',
  accentForeground: '44 87% 94%',
  success: '68 100% 27%',
  warning: '45 100% 30%',
  error: '1 71% 47%',
}

// Tokyo Night — modern dark
const tokyoNightDark: RoleSet = {
  background: '230 25% 12%',
  surface: '231 24% 17%',
  surfaceRaised: '231 24% 21%',
  surfaceSunken: '231 24% 9%',
  border: '232 17% 27%',
  borderStrong: '232 17% 36%',
  text: '230 70% 92%',
  textMuted: '230 12% 64%',
  accent: '217 92% 76%',
  accentForeground: '230 25% 12%',
  success: '152 56% 65%',
  warning: '32 92% 73%',
  error: '349 72% 65%',
}
const tokyoNightLight: RoleSet = {
  background: '218 35% 96%',
  surface: '0 0% 100%',
  surfaceRaised: '0 0% 100%',
  surfaceSunken: '218 30% 90%',
  border: '218 18% 80%',
  borderStrong: '218 18% 70%',
  text: '230 25% 18%',
  textMuted: '230 12% 38%',
  accent: '217 92% 50%',
  accentForeground: '0 0% 100%',
  success: '152 56% 35%',
  warning: '32 92% 45%',
  error: '349 72% 50%',
}

// Catppuccin Mocha — popular pastel dark
const catppuccinDark: RoleSet = {
  background: '240 21% 15%',
  surface: '237 16% 23%',
  surfaceRaised: '236 16% 27%',
  surfaceSunken: '240 21% 12%',
  border: '232 12% 39%',
  borderStrong: '232 12% 50%',
  text: '226 64% 88%',
  textMuted: '227 35% 70%',
  accent: '267 84% 81%',
  accentForeground: '240 21% 15%',
  success: '115 54% 76%',
  warning: '41 86% 83%',
  error: '343 81% 75%',
}
const catppuccinLight: RoleSet = {
  background: '220 23% 95%',
  surface: '0 0% 100%',
  surfaceRaised: '0 0% 100%',
  surfaceSunken: '223 16% 90%',
  border: '224 13% 80%',
  borderStrong: '224 13% 70%',
  text: '234 16% 35%',
  textMuted: '233 13% 55%',
  accent: '267 84% 50%',
  accentForeground: '0 0% 100%',
  success: '115 54% 35%',
  warning: '41 86% 45%',
  error: '343 81% 50%',
}

export const BUILTIN_THEMES: Theme[] = [
  mk('orchestra', 'Orchestra', orchestraLight, orchestraDark, {
    tone: { hue: 160, saturation: 10 },
  }),
  mk('nord', 'Nord', nordLight, nordDark),
  mk('dracula', 'Dracula', draculaLight, draculaDark),
  mk('solarized', 'Solarized', solarizedLight, solarizedDark),
  mk('tokyo-night', 'Tokyo Night', tokyoNightLight, tokyoNightDark),
  mk('catppuccin', 'Catppuccin Mocha', catppuccinLight, catppuccinDark),
]

export const DEFAULT_THEME_ID = 'orchestra'

export function findBuiltin(id: string): Theme | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id)
}
