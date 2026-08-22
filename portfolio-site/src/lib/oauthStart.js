import { BACKEND_URL, SITE_URL } from './siteLinks.js'

export function buildOAuthStartUrl(provider = 'google') {
  const key = String(provider || 'google').toLowerCase() === 'facebook' ? 'facebook' : 'google'
  const siteOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? String(window.location.origin).replace(/\/$/, '')
      : SITE_URL

  const url = new URL(`${BACKEND_URL}/api/auth/${key}`)
  if (siteOrigin) url.searchParams.set('redirect', siteOrigin)
  return url.toString()
}
