"use client"

/**
 * The horizontal scroller behind "Plan at a glance".
 *
 * The strip is a sequence — first topic to final checkpoint — and wrapping it
 * onto four rows lost that reading. One row scrolls sideways instead, so the
 * order stays the order and the block keeps a fixed height however many topics
 * the plan has.
 *
 * Deliberately generic: it owns scrolling and the arrows, nothing about topics.
 * `activeIndex` is the child to bring into view — the selected topic — so the
 * chip a mentor just clicked, or one selected from elsewhere, is never left off
 * screen.
 */

import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"

interface GlanceCarouselProps {
  children: ReactNode
  /** Index of the child to keep in view. -1 for none. */
  activeIndex?: number
  /** Announced to screen readers as the scroller's purpose. */
  label: string
}

export function GlanceCarousel({
  children,
  activeIndex = -1,
  label,
}: GlanceCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)

  /**
   * Which arrows are live. `overflow` is false when everything already fits,
   * and then neither arrow is shown at all — a dead control is worse than no
   * control.
   */
  const syncEdges = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    // 1px of slack: fractional scroll widths never land exactly on the end.
    const maxScroll = track.scrollWidth - track.clientWidth
    setAtStart(track.scrollLeft <= 1)
    setAtEnd(track.scrollLeft >= maxScroll - 1)
  }, [])

  useLayoutEffect(() => {
    syncEdges()
    const track = trackRef.current
    if (!track || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(syncEdges)
    observer.observe(track)
    return () => observer.disconnect()
  }, [syncEdges, children])

  /**
   * Bring the active chip into view without touching the page's own scroll
   * position — `scrollIntoView` would scroll every ancestor, which on this page
   * means jumping away from the mentor panel.
   */
  useEffect(() => {
    const track = trackRef.current
    if (!track || activeIndex < 0) return
    const chip = track.children[activeIndex] as HTMLElement | undefined
    if (!chip) return
    const left = chip.offsetLeft - (track.clientWidth - chip.offsetWidth) / 2
    track.scrollTo({ left: Math.max(0, left), behavior: "smooth" })
  }, [activeIndex])

  const page = (direction: -1 | 1) => {
    const track = trackRef.current
    if (!track) return
    // A little short of a full width, so the chip at the edge stays visible as
    // the anchor between one page and the next.
    track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" })
  }

  const overflow = !(atStart && atEnd)

  return (
    <div className={`lpb-glance-carousel${overflow ? " has-overflow" : ""}`}>
      {overflow ? (
        <button
          type="button"
          className="lpb-glance-arrow start"
          onClick={() => page(-1)}
          disabled={atStart}
          aria-label={`Scroll ${label} back`}
        >
          <ChevronLeft size={16} />
        </button>
      ) : null}
      <div
        className="lpb-glance-track"
        ref={trackRef}
        onScroll={syncEdges}
        tabIndex={0}
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      {overflow ? (
        <button
          type="button"
          className="lpb-glance-arrow end"
          onClick={() => page(1)}
          disabled={atEnd}
          aria-label={`Scroll ${label} forward`}
        >
          <ChevronRight size={16} />
        </button>
      ) : null}
    </div>
  )
}
