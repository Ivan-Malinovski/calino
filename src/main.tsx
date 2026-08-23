import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Must run before App renders so the first paint is already translated.
import { startI18n } from './lib/i18nBridge'
import App from './App.tsx'
import { config } from './config'

startI18n()

// Register service worker when enabled (requires self-hosting with proper CSP headers)
if (config.enableServiceWorker && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — silently ignore
    })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
