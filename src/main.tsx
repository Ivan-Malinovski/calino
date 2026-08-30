import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Must run before App renders so the first paint is already translated.
import { startI18n } from './lib/i18nBridge'
import { initI18n } from './lib/i18n'
import App from './App.tsx'
import { config } from './config'
import { startDynamicFavicon } from './lib/dynamicFavicon'

// Browser tab icon: current local day. No-ops on Capacitor; index.html keeps
// /calino-icon.svg as the no-JavaScript fallback.
startDynamicFavicon()

// Register service worker when enabled (requires self-hosting with proper CSP headers)
if (config.enableServiceWorker && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — silently ignore
    })
  })
}

const renderApp = (): void => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void startI18n()
  .catch((error: unknown) => {
    console.error('[i18n] startup catalog failed; falling back to English:', error)
    initI18n('en')
  })
  .then(renderApp)
