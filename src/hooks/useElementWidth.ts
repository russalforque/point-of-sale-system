import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Tracks an element's content width. Use it when a layout decision needs JS (e.g. a side
 * panel vs. a dialog) and depends on the space the page actually has — which, next to a
 * collapsible sidebar, the viewport width can't tell you.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
