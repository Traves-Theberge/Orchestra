export type HslColor = {
  hue: number
  saturation: number
  lightness: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function parseHslTriplet(input: string): HslColor {
  const match = input.trim().match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/)
  if (!match) {
    return { hue: 0, saturation: 0, lightness: 0 }
  }
  return {
    hue: normalizeHue(Number(match[1])),
    saturation: clamp(Number(match[2]), 0, 100),
    lightness: clamp(Number(match[3]), 0, 100),
  }
}

export function formatHslTriplet(color: HslColor): string {
  return `${Math.round(normalizeHue(color.hue))} ${Math.round(clamp(color.saturation, 0, 100))}% ${Math.round(clamp(color.lightness, 0, 100))}%`
}

export function hslTripletToHex(input: string): string {
  return hslToHex(parseHslTriplet(input))
}

export function hexToHslTriplet(input: string): string | null {
  const parsed = parseHex(input)
  if (!parsed) return null
  return formatHslTriplet(rgbToHsl(parsed.r, parsed.g, parsed.b))
}

export function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(hslToRgb(parseHslTriplet(foreground)))
  const bg = relativeLuminance(hslToRgb(parseHslTriplet(background)))
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

export function wcagBadge(ratio: number): 'AAA' | 'AA' | 'Fail' {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  return 'Fail'
}

function normalizeHue(value: number): number {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function parseHex(input: string): { r: number; g: number; b: number } | null {
  const hex = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return null
  const expanded = hex.length === 3 ? hex.split('').map((char) => char + char).join('') : hex
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  }
}

function hslToHex(color: HslColor): string {
  const { r, g, b } = hslToRgb(color)
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function hslToRgb(color: HslColor): { r: number; g: number; b: number } {
  const h = normalizeHue(color.hue) / 360
  const s = clamp(color.saturation, 0, 100) / 100
  const l = clamp(color.lightness, 0, 100) / 100

  if (s === 0) {
    const channel = Math.round(l * 255)
    return { r: channel, g: channel, b: channel }
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  }
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const r1 = clamp(r, 0, 255) / 255
  const g1 = clamp(g, 0, 255) / 255
  const b1 = clamp(b, 0, 255) / 255
  const max = Math.max(r1, g1, b1)
  const min = Math.min(r1, g1, b1)
  const lightness = (max + min) / 2

  if (max === min) {
    return {
      hue: 0,
      saturation: 0,
      lightness: lightness * 100,
    }
  }

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  let hue = 0

  switch (max) {
    case r1:
      hue = (g1 - b1) / delta + (g1 < b1 ? 6 : 0)
      break
    case g1:
      hue = (b1 - r1) / delta + 2
      break
    default:
      hue = (r1 - g1) / delta + 4
      break
  }

  return {
    hue: hue * 60,
    saturation: saturation * 100,
    lightness: lightness * 100,
  }
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t
  if (next < 0) next += 1
  if (next > 1) next -= 1
  if (next < 1 / 6) return p + (q - p) * 6 * next
  if (next < 1 / 2) return q
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6
  return p
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
