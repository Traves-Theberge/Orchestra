import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const rootElement: HTMLElement = (() => {
  const element = document.getElementById('root')
  if (!element) {
    throw new Error('Root mount node was not found')
  }
  return element
})()

function toDisplayMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'unknown bootstrap error'
}

function renderFatalBootFallback(message: string) {
  rootElement.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0b1020;padding:24px;color:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
      <div style="width:100%;max-width:880px;border:1px solid #3f3f46;border-radius:12px;padding:20px;background:rgba(24,24,27,.88)">
        <h1 style="margin:0 0 8px 0;font-size:22px;">Desktop bootstrap failed</h1>
        <p style="margin:0 0 12px 0;font-size:14px;color:#d4d4d8;">The app failed before React fully mounted. This prevents silent white screens.</p>
        <pre style="margin:0;padding:12px;border:1px solid #3f3f46;border-radius:8px;background:#09090b;color:#e4e4e7;white-space:pre-wrap;">${message.replace(/</g, '&lt;')}</pre>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button id="boot-reload" style="border:0;border-radius:8px;padding:8px 12px;background:#e4e4e7;color:#111827;cursor:pointer;">Reload</button>
          <button id="boot-reset-theme" style="border:1px solid #52525b;border-radius:8px;padding:8px 12px;background:transparent;color:#e4e4e7;cursor:pointer;">Reset Theme And Reload</button>
        </div>
      </div>
    </div>
  `

  const reloadButton = document.getElementById('boot-reload')
  reloadButton?.addEventListener('click', () => {
    window.location.reload()
  })

  const resetThemeButton = document.getElementById('boot-reset-theme')
  resetThemeButton?.addEventListener('click', () => {
    try {
      window.localStorage.removeItem('orchestra-theme')
    } finally {
      window.location.reload()
    }
  })
}

window.addEventListener('error', (event) => {
  console.error('global window error', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('global unhandled rejection', event.reason)
})

async function bootstrap() {
  try {
    const [{ default: App }, { CrashBoundary }] = await Promise.all([import('./App'), import('./crash-boundary')])
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <CrashBoundary>
          <App />
        </CrashBoundary>
      </React.StrictMode>,
    )
  } catch (error) {
    const message = toDisplayMessage(error)
    console.error('bootstrap failed', error)
    renderFatalBootFallback(message)
  }
}

void bootstrap()
