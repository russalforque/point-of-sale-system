import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function hasMarker(state: unknown, key: string): boolean {
  return typeof state === 'object' && state !== null && (state as Record<string, unknown>)[key] === true
}

function asRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null ? { ...(state as Record<string, unknown>) } : {}
}

/**
 * Lets the browser / Android back action close an overlay instead of leaving the page.
 *
 * On mount a same-URL history entry tagged with `key` is pushed. When that entry is
 * popped (back pressed), `onDismiss` runs. While `blocked` is true — e.g. a payment is
 * being submitted — the entry is restored, so back does nothing.
 *
 * Always close the overlay through the returned `close()` so the history entry is
 * consumed and no extra "empty" back step is left behind.
 */
export function useDismissOnBack(key: string, onDismiss: () => void, blocked = false) {
  const location = useLocation()
  const navigate = useNavigate()

  const markerPresent = hasMarker(location.state, key)
  const armedRef = useRef(false)
  const closingRef = useRef(false)
  const onDismissRef = useRef(onDismiss)
  const blockedRef = useRef(blocked)

  useEffect(() => {
    onDismissRef.current = onDismiss
    blockedRef.current = blocked
  })

  const currentUrl = `${location.pathname}${location.search}${location.hash}`

  // Push the marker entry once when the overlay opens.
  useEffect(() => {
    if (!hasMarker(location.state, key)) {
      navigate(currentUrl, { state: { ...asRecord(location.state), [key]: true } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to the marker disappearing (back pressed, or close() stepping back).
  useEffect(() => {
    if (markerPresent) {
      armedRef.current = true
      return
    }
    if (!armedRef.current) return

    if (blockedRef.current && !closingRef.current) {
      navigate(currentUrl, { state: { ...asRecord(location.state), [key]: true } })
      return
    }

    armedRef.current = false
    onDismissRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerPresent])

  function close() {
    closingRef.current = true
    if (hasMarker(location.state, key)) navigate(-1)
    else onDismissRef.current()
  }

  return { close }
}
