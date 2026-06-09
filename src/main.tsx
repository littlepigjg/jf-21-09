import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { registerServiceWorker } from './lib/offline/serviceWorker'
import { useOfflineStore } from './stores/offlineStore'

async function bootstrap() {
  registerServiceWorker('/sw.js', {
    onRegistered: () => {
      console.log('[App] Service Worker registered')
    },
    onUpdateAvailable: (reg) => {
      console.log('[App] Service Worker update available', reg)
    },
    onError: (err) => {
      console.warn('[App] Service Worker registration failed:', err)
    },
  })

  await useOfflineStore.getState().initialize()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
