'use strict'

// apps/desktop/electron/oauth-handler.cjs
//
// Opens an OAuth BrowserWindow for Linear or Jira, intercepts the redirect
// via webContents will-navigate / will-redirect events (no custom URL protocol
// needed), exchanges the authorization code for an access token, and resolves
// with the token string.
//
// REQUIRED ENVIRONMENT VARIABLES (set on the Orchestra process, never hard-code):
//   LINEAR_CLIENT_ID        — Linear OAuth app client ID
//   LINEAR_CLIENT_SECRET    — Linear OAuth app client secret
//   JIRA_CLIENT_ID          — Atlassian OAuth 2.0 (3LO) client ID
//   JIRA_CLIENT_SECRET      — Atlassian OAuth 2.0 (3LO) client secret
//   OAUTH_REDIRECT_URI      — (optional) override the default redirect URI

const { BrowserWindow } = require('electron')

const PROVIDERS = {
  linear: {
    authBase: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scope: 'read,write',
    clientIdEnv: 'LINEAR_CLIENT_ID',
    clientSecretEnv: 'LINEAR_CLIENT_SECRET',
  },
  jira: {
    authBase: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scope: 'read:jira-work write:jira-work offline_access',
    audience: 'api.atlassian.com',
    clientIdEnv: 'JIRA_CLIENT_ID',
    clientSecretEnv: 'JIRA_CLIENT_SECRET',
  },
}

const DEFAULT_REDIRECT_URI = 'http://localhost:1234/oauth/callback'

/**
 * Opens an OAuth BrowserWindow, intercepts the redirect, exchanges the code
 * for an access token, and resolves with the token.
 *
 * Requires the provider's client_id/client_secret to be set in environment
 * variables (see PROVIDERS table above). Throws if any required env var is
 * missing so the UI can surface a clear error to the user.
 *
 * @param {string} provider - 'linear' | 'jira'
 * @returns {Promise<string>} access token
 */
async function openOAuthWindow(provider) {
  const cfg = PROVIDERS[provider]
  if (!cfg) {
    throw new Error(`Unsupported OAuth provider: ${provider}`)
  }

  const clientId = process.env[cfg.clientIdEnv]
  const clientSecret = process.env[cfg.clientSecretEnv]
  const redirectUri = process.env.OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI

  if (!clientId) {
    throw new Error(
      `${cfg.clientIdEnv} is not set. Register an OAuth app with ${provider} and set ` +
      `${cfg.clientIdEnv} and ${cfg.clientSecretEnv} as environment variables on the Orchestra process.`
    )
  }
  if (!clientSecret) {
    throw new Error(`${cfg.clientSecretEnv} is not set.`)
  }

  const state = Math.random().toString(36).slice(2)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
  })
  if (cfg.audience) {
    params.set('audience', cfg.audience)
  }

  const authUrl = `${cfg.authBase}?${params.toString()}`

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 600,
      height: 700,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    let settled = false

    const cleanup = (err, token) => {
      if (settled) return
      settled = true
      try { win.close() } catch (_) { /* ignore */ }
      if (err) reject(err)
      else resolve(token)
    }

    const interceptRedirect = (event, url) => {
      if (!url.startsWith(redirectUri)) return
      // Prevent the window from actually navigating to the redirect URI
      if (typeof event.preventDefault === 'function') {
        event.preventDefault()
      }
      try {
        const u = new URL(url)
        const code = u.searchParams.get('code')
        const returnedState = u.searchParams.get('state')
        const errorParam = u.searchParams.get('error')

        if (errorParam) {
          cleanup(new Error(`OAuth error: ${errorParam}`))
          return
        }
        if (returnedState !== state) {
          cleanup(new Error('OAuth state mismatch — possible CSRF, aborting'))
          return
        }
        if (!code) {
          cleanup(new Error('OAuth redirect missing code'))
          return
        }

        exchangeCodeForToken(cfg.tokenUrl, code, redirectUri, clientId, clientSecret)
          .then((token) => cleanup(null, token))
          .catch((exchangeErr) => cleanup(exchangeErr))
      } catch (parseErr) {
        cleanup(parseErr)
      }
    }

    win.webContents.on('will-redirect', interceptRedirect)
    win.webContents.on('will-navigate', interceptRedirect)
    win.on('closed', () => cleanup(new Error('OAuth window closed before completing')))

    win.loadURL(authUrl).catch((loadErr) => cleanup(loadErr))
  })
}

/**
 * POSTs the authorization code to the provider's token endpoint and returns
 * the access_token string. Runs entirely in the Electron main process so the
 * client_secret never touches the renderer.
 */
async function exchangeCodeForToken(tokenUrl, code, redirectUri, clientId, clientSecret) {
  const body = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Token exchange failed: ${res.status} ${text}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Token exchange response missing access_token')
  }

  return data.access_token
}

module.exports = { openOAuthWindow }
