import { useEffect, useRef, useState } from 'react'

/*
 * A baton conducting 4/4 while the agent works.
 *
 * The path follows the real pattern: down to beat 1, rebound and across to
 * beat 2 on the left, over to beat 3 on the right, then up to beat 4 and the
 * next downbeat. Like a conductor's wrist, the tip accelerates into each ictus
 * (the click where the beat lands) and floats through the top of the rebound.
 * Each ictus sends out a ripple, accented on the downbeat. Tempo follows the
 * work, and changes glide because the beat phase integrates the live tempo.
 *
 * Only SVG attributes and transform/opacity change per frame; reduced motion
 * shows the pattern at rest.
 */

// Beat k is the cubic segment ending at ictus k (1 bottom, 2 left, 3 right, 4 top).
const SEGMENTS = [
  'M20 3 C16.5 9.5 17.5 18 20 24',
  'C21.5 17 13 12.5 6 18.5',
  'C8.5 11.5 27 12 34 18.5',
  'C38 11 30 2 20 3',
]
const PATH = SEGMENTS.join(' ')
const ICTUS = [[20, 24], [6, 18.5], [34, 18.5], [20, 3]] as const
// Comet: long faint tail to short bright head.
const TRAILS = [
  { length: 26, width: 1.1, opacity: 0.12 },
  { length: 14, width: 1.5, opacity: 0.3 },
  { length: 6, width: 1.9, opacity: 0.75 },
]
// Speed up into the ictus, float at the rebound peak (velocity 1 + a·cos 2πt).
const SWING = 0.72
const ease = (t: number) => t + (SWING / (2 * Math.PI)) * Math.sin(2 * Math.PI * t)

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

export function ConductorBaton({ tempo, className = '' }: {
  /** Beats per minute; changes glide, they never jump the beat. */
  tempo: number
  className?: string
}) {
  const reduced = usePrefersReducedMotion()
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const trailRefs = useRef<(SVGPathElement | null)[]>([])
  const tipRef = useRef<SVGCircleElement>(null)
  const haloRef = useRef<SVGCircleElement>(null)
  const rippleRefs = useRef<(SVGCircleElement | null)[]>([])
  const tempoRef = useRef(tempo)
  useEffect(() => { tempoRef.current = tempo }, [tempo])

  useEffect(() => {
    const svg = svgRef.current
    const path = pathRef.current
    if (reduced || !svg || !path || typeof path.getTotalLength !== 'function') return
    const total = path.getTotalLength()
    if (!total) return
    // Cumulative length at each ictus, measured on the rendered geometry.
    const ends = SEGMENTS.map((_, index) => {
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      probe.setAttribute('d', SEGMENTS.slice(0, index + 1).join(' '))
      probe.setAttribute('visibility', 'hidden')
      svg.appendChild(probe)
      const length = probe.getTotalLength()
      probe.remove()
      return length
    })
    for (const [index, trail] of trailRefs.current.entries()) {
      // One dash per loop, so the tail wraps cleanly from beat 4 into beat 1.
      trail?.setAttribute('stroke-dasharray', `${TRAILS[index].length} ${total - TRAILS[index].length}`)
    }

    let ripple = 0
    const land = (beat: number) => {
      const node = rippleRefs.current[ripple++ % rippleRefs.current.length]
      if (!node || typeof node.animate !== 'function') return
      const [x, y] = ICTUS[beat]
      node.setAttribute('cx', String(x))
      node.setAttribute('cy', String(y))
      const downbeat = beat === 0
      node.animate(
        [{ transform: 'scale(0.25)', opacity: downbeat ? 0.6 : 0.35 }, { transform: `scale(${downbeat ? 1.9 : 1.3})`, opacity: 0 }],
        { duration: downbeat ? 720 : 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
      tipRef.current?.animate?.(
        [{ transform: `scale(${downbeat ? 1.6 : 1.3})` }, { transform: 'scale(1)' }],
        { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    }

    let phase = 0
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      // rAF timestamps can predate the effect; clamp so the beat never runs backwards or leaps after a hidden tab.
      const dt = Math.max(0, Math.min(64, now - last))
      last = now
      const previous = phase
      phase += (dt / 1000) * (tempoRef.current / 60)
      if (Math.floor(phase) !== Math.floor(previous)) land((Math.floor(phase) + 3) % 4)
      const beat = Math.floor(phase) % 4
      const start = beat === 0 ? 0 : ends[beat - 1]
      const at = start + (ends[beat] - start) * ease(phase % 1)
      const point = path.getPointAtLength(at)
      tipRef.current?.setAttribute('cx', point.x.toFixed(2))
      tipRef.current?.setAttribute('cy', point.y.toFixed(2))
      haloRef.current?.setAttribute('cx', point.x.toFixed(2))
      haloRef.current?.setAttribute('cy', point.y.toFixed(2))
      for (const [index, trail] of trailRefs.current.entries()) {
        const offset = (((TRAILS[index].length - at) % total) + total) % total
        trail?.setAttribute('stroke-dashoffset', offset.toFixed(2))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced])

  const [restX, restY] = ICTUS[0]
  return (
    <svg ref={svgRef} viewBox="0 0 40 28" aria-hidden="true" className={`overflow-visible text-primary ${className}`}>
      <path ref={pathRef} d={PATH} fill="none" stroke="currentColor" strokeOpacity={reduced ? 0.22 : 0.035} strokeWidth={1} strokeLinecap="round" />
      {!reduced && TRAILS.map((trail, index) => (
        <path key={index} ref={node => { trailRefs.current[index] = node }} d={PATH} fill="none" stroke="currentColor"
          strokeOpacity={trail.opacity} strokeWidth={trail.width} strokeLinecap="round" strokeDasharray="0 1000" />
      ))}
      {!reduced && [0, 1, 2, 3].map(index => (
        <circle key={index} ref={node => { rippleRefs.current[index] = node }} r={3.2} fill="none" stroke="currentColor" strokeWidth={0.8}
          opacity={0} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      ))}
      <circle ref={haloRef} cx={restX} cy={restY} r={3.4} fill="currentColor" opacity={reduced ? 0 : 0.18} style={{ filter: 'blur(1.2px)' }} />
      <circle ref={tipRef} cx={restX} cy={restY} r={1.7} fill="currentColor" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    </svg>
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
