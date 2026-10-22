import { useEffect } from 'react'

/** Android keyboards can resize the visual viewport without resizing the WebView layout. */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport
    const update = () => {
      // Keep pinch-to-zoom available without shrinking the app under the user's fingers.
      if (viewport && viewport.scale !== 1) return
      document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`)
      document.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`)
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--app-height')
      document.documentElement.style.removeProperty('--app-top')
    }
  }, [])
}
