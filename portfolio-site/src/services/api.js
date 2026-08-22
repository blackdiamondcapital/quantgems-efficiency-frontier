import { BACKEND_URL } from '../lib/siteLinks.js'

function apiBase() {
  if (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return window.location.origin
  }
  return BACKEND_URL
}

function authHeader() {
  try {
    const token = localStorage.getItem('quantgem_auth_token')
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

async function request(path, options = {}) {
  const bases = [apiBase(), BACKEND_URL].filter(Boolean)
  const unique = [...new Set(bases)]
  let lastError = '連線失敗'
  for (const base of unique) {
    try {
      const resp = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeader(),
          ...(options.headers || {}),
        },
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        lastError = json.message || json.error || `HTTP ${resp.status}`
        if (resp.status >= 500) continue
        throw new Error(lastError)
      }
      return json
    } catch (err) {
      lastError = String(err?.message || err)
    }
  }
  throw new Error(lastError)
}

export function searchSymbols(q) {
  return request(`/api/portfolios/search?q=${encodeURIComponent(q || '')}`)
}

export function computeFrontier(payload) {
  return request('/api/portfolios/frontier', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
