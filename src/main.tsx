import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App'
import { initDatabase } from './database/sqlite'
import { initializeDatabase } from './database/database'
import { seedDatabase } from './database/seed'

async function startApp() {
  const root = document.getElementById('root')

  if (!root) {
    throw new Error('Root element not found')
  }

  console.log('=== SELLIX START ===')
  console.log('Platform:', Capacitor.getPlatform())
  console.log('Native:', Capacitor.isNativePlatform())

  if (Capacitor.isNativePlatform()) {
    try {
      console.log('=== SQLITE START ===')

      await initDatabase()

      console.log('=== SQLITE OPENED ===')

      await initializeDatabase()
      await seedDatabase()

      console.log('=== SQLITE READY ===')
    } catch (error) {
      console.error('=== SQLITE ERROR ===', error)
    }
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

startApp()