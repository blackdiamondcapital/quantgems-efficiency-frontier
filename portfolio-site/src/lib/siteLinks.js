export const MAIN_SITE_URL = String(import.meta.env.VITE_MAIN_SITE_URL || 'https://www.quantgems.com')
  .trim()
  .replace(/\/$/, '')

export const PRICING_URL = `${MAIN_SITE_URL}/pricing`

export const SITE_URL = String(import.meta.env.VITE_SITE_URL || 'https://portfolio.quantgems.com')
  .trim()
  .replace(/\/$/, '')

export const BACKEND_URL = String(
  import.meta.env.VITE_BACKEND_URL
    || 'https://taiwan-stock-returns-quantgems-vue-vercel.onrender.com'
)
  .trim()
  .replace(/\/$/, '')
