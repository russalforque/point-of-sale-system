import { useEffect, useRef } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { useLocation } from 'react-router-dom'

import { isMoreSheetOpen } from '../components/layout/MoreSheet'

/** The start destination: pressing back here (with nothing open) exits the app. */
const HOME_PATH = '/dashboard'

/**
 * Handles the Android hardware/gesture back action inside the authenticated app.
 *
 * - UI that should close on back (the "More" sheet) pushes a history entry when it
 *   opens, so going back in history dismisses it before leaving the screen.
 * - On the Home screen with nothing open, back exits the app (standard Android
 *   bottom-navigation behavior, and it avoids stepping back to the login screen).
 * - Elsewhere, back moves to the previous screen, or exits when there is none.
 *
 * No-op on the web, where the browser's own back button already uses history.
 */
export function useAndroidBackButton() {
  const location = useLocation()
  const shouldExitRef = useRef(false)

  useEffect(() => {
    shouldExitRef.current = location.pathname === HOME_PATH && !isMoreSheetOpen(location.state)
  }, [location])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let handle: PluginListenerHandle | undefined
    let disposed = false

    void App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && !shouldExitRef.current) {
        window.history.back()
      } else {
        void App.exitApp()
      }
    }).then((listener) => {
      if (disposed) void listener.remove()
      else handle = listener
    })

    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [])
}
