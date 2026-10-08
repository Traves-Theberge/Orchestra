import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/*
 * A baton conducting 4/4 while the agent works.
 *
 * The path follows the real pattern: down to beat 1, rebound and across to
 * beat 2 on the left, over to beat 3 on the right, then up to beat 4 and the
 * next downbeat. Like a conductor's wrist, the tip accelerates into each ictus
 * (the click where the beat lands) and floats through the top of the rebound.
 *
 * Smoothness: the whole measure is sampled once into transform keyframes, and
 * every moving part (tip, comet trail, ictus ripples, tip flick) animates only
 * transform and opacity on plain elements. The compositor runs these, so the
 * baton stays fluid while React renders, the user types, or the chat polls.
 * Tempo changes glide via updatePlaybackRate, which never moves the beat.
 */

const VIEW = { width: 40, height: 28 }
// Beat k is the cubic segment ending at ictus k (1 bottom, 2 left, 3 right, 4 top).
const SEGMENTS = [
  'M20 3 C16.5 9.5 17.5 18 20 24',
  'C21.5 17 13 12.5 6 18.5',
  'C8.5 11.5 27 12 34 18.5',
  'C38 11 30 2 20 3',
]
const PATH = SEGMENTS.join(' ')
const ICTUS = [[20, 24], [6, 18.5], [34, 18.5], [20, 3]] as const
const SAMPLES = 192 // per measure; linear between samples is visually exact at this density
const BASE_BPM = 60
const MEASURE_MS = (4 * 60_000) / BASE_BPM
// Speed up into the ictus, float at the rebound peak (velocity 1 + a·cos 2πt).
const SWING = 0.72
const ease = (t: number) => t + (SWING / (2 * Math.PI)) * Math.sin(2 * Math.PI * t)
// Comet: head first, then ghosts that lag in beat-time (so the tail scales with tempo).
const COMET = [
  { lag: 0, size: 4.2, opacity: 1 },
  { lag: 0.035, size: 3.4, opacity: 0.5 },
  { lag: 0.07, size: 2.9, opacity: 0.32 },
  { lag: 0.11, size: 2.4, opacity: 0.2 },
  { lag: 0.155, size: 2, opacity: 0.12 },
  { lag: 0.205, size: 1.6, opacity: 0.07 },
]
const SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** Points along one measure in viewBox units, with the conductor's timing baked in. */
let measureCache: { x: number; y: number }[] | null = null
function measurePoints(): { x: number; y: number }[] | null {
  if (measureCache) return measureCache
  if (typeof document === 'undefined') return null
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.position = 'absolute'
  svg.style.visibility = 'hidden'
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  svg.appendChild(probe)
  document.body.appendChild(svg)
  try {
    if (typeof probe.getTotalLength !== 'function') return null
    const ends = SEGMENTS.map((_, index) => { probe.setAttribute('d', SEGMENTS.slice(0, index + 1).join(' ')); return probe.getTotalLength() })
    probe.setAttribute('d', PATH)
    if (!ends[3]) return null
    const points = []
    for (let i = 0; i <= SAMPLES; i++) {
      const phase = (i / SAMPLES) * 4
      const beat = Math.min(3, Math.floor(phase))
      const start = beat === 0 ? 0 : ends[beat - 1]
      const point = probe.getPointAtLength(start + (ends[beat] - start) * ease(phase - beat))
      points.push({ x: point.x, y: point.y })
    }
    measureCache = points
    return points
  } catch {
    return null
  } finally {
    svg.remove()
  }
}

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const onChange = () => setReduced(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}

export function ConductorBaton({ tempo, width = 37, className = '' }: {
  /** Beats per minute; changes glide, they never jump the beat. */
  tempo: number
  /** Rendered width in px; height follows the pattern's aspect. */
  width?: number
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const scale = width / VIEW.width
  const height = VIEW.height * scale
  const cometRefs = useRef<(HTMLSpanElement | null)[]>([])
  const flickRef = useRef<HTMLSpanElement>(null)
  const rippleRefs = useRef<(HTMLSpanElement | null)[]>([])
  const animations = useRef<Animation[]>([])
  const rate = useRef(tempo / BASE_BPM)

  useLayoutEffect(() => {
    if (reduced) return
    const points = measurePoints()
    if (!points || typeof document.body.animate !== 'function') return
    const created: Animation[] = []
    const timing = (delay = 0): KeyframeAnimationOptions => ({ duration: MEASURE_MS, iterations: Infinity, easing: 'linear', delay })
    const translate = (x: number, y: number, size: number) => `translate3d(${(x * scale - size / 2).toFixed(2)}px, ${(y * scale - size / 2).toFixed(2)}px, 0)`
    const frames = (size: number) => points.map((p, i) => ({ offset: i / SAMPLES, transform: translate(p.x, p.y, size) }))
    // The head leads; each ghost starts a little earlier in the measure behind it.
    const lead = COMET[COMET.length - 1].lag * (MEASURE_MS / 4)
    for (const [index, dot] of COMET.entries()) {
      const node = cometRefs.current[index]
      if (node) created.push(node.animate(frames(dot.size), timing(-(lead - dot.lag * (MEASURE_MS / 4)))))
    }
    // The tip flicks at each ictus; beat 1 (the downbeat) a little more.
    const flick = flickRef.current
    if (flick) {
      const keys: Keyframe[] = []
      for (let beat = 0; beat < 4; beat++) {
        const at = beat / 4
        keys.push({ offset: at, transform: `scale(${beat === 0 ? 1.55 : 1.3})`, easing: SPRING }, { offset: at + 0.07, transform: 'scale(1)' })
      }
      keys.push({ offset: 1, transform: 'scale(1.55)' })
      created.push(flick.animate(keys, timing(-lead)))
    }
    // A ripple opens where each beat lands. Ictus k is reached at (k + 1) / 4 of the measure.
    for (const [beat, node] of rippleRefs.current.entries()) {
      if (!node) continue
      const at = ((beat + 1) % 4) / 4
      const peak = beat === 0 ? 0.55 : 0.32
      const grow = beat === 0 ? 2.1 : 1.5
      const keys: Keyframe[] = at === 0
        ? [{ offset: 0, opacity: peak, transform: 'scale(0.3)', easing: SPRING }, { offset: 0.16, opacity: 0, transform: `scale(${grow})` }, { offset: 1, opacity: 0, transform: `scale(${grow})` }]
        : [{ offset: 0, opacity: 0, transform: 'scale(0.3)' }, { offset: at, opacity: peak, transform: 'scale(0.3)', easing: SPRING }, { offset: Math.min(1, at + 0.16), opacity: 0, transform: `scale(${grow})` }, { offset: 1, opacity: 0, transform: `scale(${grow})` }]
      created.push(node.animate(keys, timing(-lead)))
    }
    for (const animation of created) animation.playbackRate = rate.current
    animations.current = created
    return () => { for (const animation of created) animation.cancel(); animations.current = [] }
  }, [reduced, scale])

  // Glide to a new tempo over ~600ms; the beat position is never disturbed.
  useEffect(() => {
    const target = tempo / BASE_BPM
    const from = rate.current
    if (Math.abs(target - from) < 0.001) return
    const startedAt = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / 600)
      const next = from + (target - from) * (1 - Math.pow(1 - t, 3))
      rate.current = next
      for (const animation of animations.current) {
        if (typeof animation.updatePlaybackRate === 'function') animation.updatePlaybackRate(next)
        else animation.playbackRate = next
      }
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [tempo])

  const [restX, restY] = ICTUS[0]
  const head = COMET[0]
  return (
    <span aria-hidden="true" className={`relative inline-block shrink-0 text-primary ${className}`} style={{ width, height }}>
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} width={width} height={height} className="absolute inset-0 overflow-visible">
        <path d={PATH} fill="none" stroke="currentColor" strokeOpacity={reduced ? 0.25 : 0.06} strokeWidth={1} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {!reduced && ICTUS.map(([x, y], beat) => (
        <span key={beat} ref={node => { rippleRefs.current[beat] = node }}
          className="absolute rounded-full border border-current opacity-0 will-change-transform"
          style={{ width: 8, height: 8, left: x * scale - 4, top: y * scale - 4 }} />
      ))}
      {!reduced && COMET.slice(1).reverse().map((dot) => {
        const index = COMET.indexOf(dot)
        return (
          <span key={index} ref={node => { cometRefs.current[index] = node }}
            className="absolute left-0 top-0 rounded-full bg-current will-change-transform"
            style={{ width: dot.size, height: dot.size, opacity: dot.opacity, transform: `translate3d(${restX * scale - dot.size / 2}px, ${restY * scale - dot.size / 2}px, 0)` }} />
        )
      })}
      <span ref={node => { cometRefs.current[0] = node }} className="absolute left-0 top-0 will-change-transform"
        style={{ width: head.size, height: head.size, transform: `translate3d(${restX * scale - head.size / 2}px, ${restY * scale - head.size / 2}px, 0)` }}>
        <span ref={flickRef} className="block size-full rounded-full bg-current will-change-transform"
          style={{ boxShadow: '0 0 6px 1.5px color-mix(in oklab, currentColor 55%, transparent)' }} />
      </span>
    </span>
  )
}

/** Tempo for the agent's current activity, in BPM. */
export function activityTempo(activity: string, stopping: boolean): number {
  if (stopping) return 34 // ritardando
  if (/reason|think/i.test(activity)) return 64 // adagio
  if (/writ/i.test(activity)) return 88 // moderato
  if (/command|edit|tool|search/i.test(activity)) return 112 // allegro
  return 80 // andante
}
