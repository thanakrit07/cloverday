import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// Native-app "push" navigation for the full-screen pages (FullScreenPage,
// EntryPage): the page slides in from the right when it mounts, slides back
// out to the right when closed from inside the app, and can be dragged off
// with a finger from the left edge — following the finger the whole way and
// either finishing the close or springing back on release, like iOS's own
// swipe-back.
//
// Only in-app closes animate out (`close`). A close that comes from outside
// — the browser's Back, or a parent dropping the page after a Save — still
// unmounts straight away; iOS Safari already plays its own swipe-back
// animation for the former, and running ours on top would double it.

// Only a drag starting this close to the left edge arms the gesture — the
// same region iOS's own edge-swipe-back uses, so it never competes with an
// ordinary tap or a vertical scroll started anywhere else on the page
// (SwipeableRow's row-swipe is the same idea, applied per-row instead).
const EDGE_WIDTH = 24
const DIRECTION_LOCK = 8
// Released past this fraction of the width, or flicked faster than this
// (px/ms) to the right, the drag finishes the close.
const DISMISS_FRACTION = 0.35
const DISMISS_VELOCITY = 0.5
const DURATION = 320
// iOS's navigation curve: a quick start that settles gently.
const EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'
const BACKDROP_OPACITY = 0.25

type Phase = 'entering' | 'open' | 'leaving'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function usePushTransition(onClose: () => void, enabled: boolean) {
  const animate = enabled && !prefersReducedMotion()
  const [phase, setPhase] = useState<Phase>(animate ? 'entering' : 'open')
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number } | null>(null)
  const last = useRef<{ x: number; t: number; v: number }>({ x: 0, t: 0, v: 0 })
  const armed = useRef(false)
  const width = useRef(typeof window === 'undefined' ? 0 : window.innerWidth)
  const closeTimer = useRef<number | undefined>(undefined)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Two frames so the off-screen starting position is actually painted
  // before the transition to on-screen begins.
  useEffect(() => {
    if (phase !== 'entering') return
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase('open'))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [phase])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  // Pointer events alone lose the gesture: as soon as a touch moves, the
  // browser may claim it for scrolling and send pointercancel. Cancelling
  // the touchmove itself — which needs a non-passive native listener, React's
  // are passive — keeps an edge drag that's going sideways ours.
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!element || !enabled) return
    function onTouchMove(e: TouchEvent) {
      if (!armed.current || !start.current) return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - start.current.x
      const dy = t.clientY - start.current.y
      if (Math.abs(dx) > Math.abs(dy)) e.preventDefault()
    }
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => element.removeEventListener('touchmove', onTouchMove)
  }, [element, enabled])

  function close() {
    if (phase === 'leaving') return
    if (!animate) {
      onCloseRef.current()
      return
    }
    setPhase('leaving')
    setDragging(false)
    closeTimer.current = window.setTimeout(() => onCloseRef.current(), DURATION)
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (phase === 'leaving') return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.clientX > EDGE_WIDTH) return
    start.current = { x: e.clientX, y: e.clientY }
    last.current = { x: e.clientX, t: e.timeStamp, v: 0 }
    armed.current = true
    width.current = e.currentTarget.clientWidth || window.innerWidth
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!armed.current || !start.current) return
    const dx = e.clientX - start.current.x
    const dy = e.clientY - start.current.y
    if (!dragging) {
      if (Math.abs(dx) < DIRECTION_LOCK && Math.abs(dy) < DIRECTION_LOCK) return
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical intent (scrolling the page) — release the gesture.
        armed.current = false
        return
      }
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    const dt = e.timeStamp - last.current.t
    if (dt > 0) last.current = { x: e.clientX, t: e.timeStamp, v: (e.clientX - last.current.x) / dt }
    setOffset(Math.max(0, dx))
  }

  function onPointerUp() {
    const wasDragging = dragging
    armed.current = false
    start.current = null
    setDragging(false)
    if (!wasDragging) return
    if (offset > width.current * DISMISS_FRACTION || last.current.v > DISMISS_VELOCITY) {
      close()
    } else {
      setOffset(0)
    }
  }

  const transform =
    phase === 'open' ? (offset ? `translateX(${offset}px)` : undefined) : 'translateX(100%)'
  const transition =
    dragging || phase === 'entering' || !animate ? undefined : `transform ${DURATION}ms ${EASING}`
  // How much of the page is on screen, 0–1, for the backdrop behind it.
  const shown = phase === 'open' ? 1 - Math.min(1, offset / (width.current || 1)) : 0

  return {
    close,
    handlers: enabled ? { ref: setElement, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } : {},
    pageStyle: {
      transform,
      transition,
      boxShadow: phase !== 'open' || offset ? '-16px 0 32px -12px rgb(0 0 0 / 0.25)' : undefined,
    } satisfies CSSProperties,
    backdropStyle: {
      opacity: enabled ? shown * BACKDROP_OPACITY : 0,
      transition: dragging || !animate ? undefined : `opacity ${DURATION}ms ${EASING}`,
    } satisfies CSSProperties,
  }
}
