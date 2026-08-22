import { computed, ref } from 'vue'
import { BACKEND_URL } from '../lib/siteLinks.js'

const TOKEN_KEY = 'quantgem_auth_token'
const USER_KEY = 'quantgem_user'

function planLabelFromUser(userObj) {
  const plan = String(userObj?.effective_plan || userObj?.effectivePlan || userObj?.plan || '').toLowerCase()
  const role = String(userObj?.role || '').toLowerCase()
  if (role === 'admin' || plan === 'admin') return 'Admin'
  if (plan === 'prime' || plan === 'enterprise') return 'Prime'
  const subscriptionActive = String(userObj?.subscription_status || '').toLowerCase() === 'active'
  const trialEndsAt = userObj?.trial_ends_at || userObj?.trial_end_date || userObj?.trial_end
  const trialActive = userObj?.is_trial_active === true
    || (trialEndsAt && Number.isFinite(new Date(trialEndsAt).getTime()) && new Date(trialEndsAt).getTime() > Date.now())
  if (plan === 'pro' || plan === 'trial_pro' || subscriptionActive || trialActive) return 'Pro'
  return 'Free'
}

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    try { localStorage.removeItem(USER_KEY) } catch {}
    return null
  }
}

const token = ref(localStorage.getItem(TOKEN_KEY) || null)
const user = ref(token.value ? readStoredUser() : null)
const loading = ref(false)
const authError = ref('')

if (!token.value) {
  try {
    user.value = null
    localStorage.removeItem(USER_KEY)
  } catch {}
}

function setToken(newToken) {
  token.value = newToken || null
  try {
    if (newToken) localStorage.setItem(TOKEN_KEY, newToken)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

function setUser(newUser) {
  user.value = newUser || null
  try {
    if (newUser) localStorage.setItem(USER_KEY, JSON.stringify(newUser))
    else localStorage.removeItem(USER_KEY)
  } catch {}
}

function authMeCandidates() {
  const paths = []
  if (typeof window !== 'undefined') paths.push(`${window.location.origin}/api/auth/me`)
  if (BACKEND_URL) paths.push(`${BACKEND_URL}/api/auth/me`)
  return [...new Set(paths)]
}

function extractUser(json) {
  return json?.data?.user || json?.user || null
}

function localizedOAuthError(value) {
  const code = String(value || '').trim().toLowerCase()
  if (code === 'access_denied') return '你已取消登入授權'
  if (code === 'account_disabled') return '此帳號目前無法登入'
  if (code === 'oauth_failed') return 'Google 登入未完成，請再試一次'
  return '登入未完成，請重新操作'
}

export function consumeOAuthCallbackFromUrl() {
  if (typeof window === 'undefined') return { token: null, error: null, provider: '' }
  const url = new URL(window.location.href)
  let oauthToken = url.searchParams.get('token')
  let oauthError = url.searchParams.get('error')
  let provider = url.searchParams.get('provider') || ''

  if (!oauthToken && url.hash) {
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    oauthToken = hash.get('token') || oauthToken
    oauthError = hash.get('error') || oauthError
    provider = hash.get('provider') || provider
  }

  if (oauthToken || oauthError) {
    url.searchParams.delete('token')
    url.searchParams.delete('error')
    url.searchParams.delete('provider')
    url.hash = ''
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }

  return { token: oauthToken, error: oauthError, provider }
}

async function fetchCurrentUser() {
  if (!token.value) {
    setUser(null)
    return null
  }
  loading.value = true
  authError.value = ''
  let lastError = ''
  try {
    const candidates = authMeCandidates()
    let unauthorizedCount = 0
    for (const endpoint of candidates) {
      try {
        const resp = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token.value}` },
          cache: 'no-store',
          credentials: 'include',
        })
        const json = await resp.json().catch(() => ({}))
        if (resp.status === 401) {
          unauthorizedCount += 1
          lastError = json?.message || '登入狀態已失效，請重新登入'
          continue
        }
        if (!resp.ok) {
          lastError = json?.message || `HTTP ${resp.status}`
          continue
        }
        const nextUser = extractUser(json)
        if (!nextUser) {
          lastError = '無法讀取使用者資料'
          continue
        }
        setUser(nextUser)
        return nextUser
      } catch (err) {
        lastError = String(err?.message || err)
      }
    }
    if (unauthorizedCount === candidates.length) {
      setToken(null)
      setUser(null)
    }
    authError.value = lastError || '請先登入 QuantGems 主站'
    return null
  } finally {
    loading.value = false
  }
}

async function refreshUser() {
  const oauth = consumeOAuthCallbackFromUrl()
  if (oauth.error) authError.value = localizedOAuthError(oauth.error)
  else if (oauth.token) setToken(oauth.token)
  if (!token.value) {
    setUser(null)
    return null
  }
  return fetchCurrentUser()
}

async function logout() {
  const endpoints = []
  if (BACKEND_URL) endpoints.push(`${BACKEND_URL}/api/auth/logout`)
  if (typeof window !== 'undefined') endpoints.push(`${window.location.origin}/api/auth/logout`)
  try {
    if (token.value) {
      for (const endpoint of endpoints) {
        try {
          await fetch(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token.value}`,
              'Content-Type': 'application/json',
            },
          })
          break
        } catch { /* try next */ }
      }
    }
  } finally {
    setUser(null)
    setToken(null)
    authError.value = ''
  }
}

export function useAuth() {
  return {
    token,
    user,
    loading,
    authError,
    isAuthenticated: computed(() => Boolean(token.value && user.value?.id)),
    displayName: computed(() => {
      const u = user.value
      if (!u) return ''
      return u.full_name || u.username || u.email || '會員'
    }),
    planLabel: computed(() => planLabelFromUser(user.value)),
    setToken,
    setUser,
    fetchCurrentUser,
    refreshUser,
    logout,
  }
}
