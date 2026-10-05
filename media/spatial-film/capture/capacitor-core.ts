// Capture-only: report a native platform so the app takes its SQLite code paths.
import { Capacitor } from '@capacitor/core'
export * from '@capacitor/core'
;(Capacitor as any).isNativePlatform = () => true
