import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { hasLocalDatabase } from './services/platform'
import './index.css'
import App from './App'
import { initDatabase } from './database/sqlite'
import { initializeDatabase } from './database/database'
import { seedDatabase } from './database/seed'
import { recordPendingRestoreAudit } from './services/backup'

async function startApp() {
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Root element not found')
  }

  console.log('=== SELLIX START ===')
  console.log('Platform:', Capacitor.getPlatform())
  console.log('Native:', hasLocalDatabase())

  if (hasLocalDatabase()) {
    try {
      console.log('=== SQLITE START ===')

      await initDatabase()

      console.log('=== SQLITE OPENED ===')

      await initializeDatabase()
      await seedDatabase()
      await recordPendingRestoreAudit()

      console.log('=== SQLITE READY ===')
    } catch (error) {
      console.error('=== SQLITE ERROR ===', error)
      createRoot(root).render(
        <div style={{ padding: 32, fontFamily: 'sans-serif' }} role="alert">
          <h1>Unable to open Sellix data</h1>
          <p>Database setup did not complete. Your existing data has been retained. Restart to retry before recording transactions.</p>
          <p>{error instanceof Error ? error.message : 'Check available storage and restart Sellix.'}</p>
          <button onClick={() => window.location.reload()}>Restart Sellix</button>
        </div>,
      )
      return
    }
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

startApp()
