<script setup>
import { onMounted } from 'vue'
import PortfolioView from './components/PortfolioView.vue'
import AuthBar from './components/AuthBar.vue'
import { useAuth } from './stores/auth'
import { buildOAuthStartUrl } from './lib/oauthStart'
import { MAIN_SITE_URL } from './lib/siteLinks'

const { authError, isAuthenticated, refreshUser } = useAuth()
const currentYear = new Date().getFullYear()

function openGoogleLogin() {
  window.location.href = buildOAuthStartUrl('google')
}

onMounted(() => {
  refreshUser()
})
</script>

<template>
  <div class="site-shell">
    <header class="site-header">
      <div class="site-brand">
        <div class="brand-mark">
          <img src="/quantgems-mark.svg" alt="" aria-hidden="true" />
        </div>
        <h1 class="brand-title">
          <span class="brand-title-name">QuantGems®</span>
          <span>投資組合</span>
        </h1>
      </div>
      <AuthBar />
    </header>

    <div v-if="authError && !isAuthenticated" class="auth-banner">
      {{ authError }}。請使用右上角「Google 登入」（與主站同一套帳號）。
    </div>

    <PortfolioView @show-login="openGoogleLogin" />

    <footer class="product-footer">
      <span>© {{ currentYear }} QuantGems®｜馬可維茲效率前緣僅供研究參考，不構成投資建議。</span>
      <nav aria-label="相關連結">
        <a :href="MAIN_SITE_URL" target="_blank" rel="noopener noreferrer">QuantGems® 主站</a>
        <a :href="`${MAIN_SITE_URL}/pricing`" target="_blank" rel="noopener noreferrer">訂閱方案</a>
        <a href="https://paper.quantgems.com/" target="_blank" rel="noopener noreferrer">模擬交易</a>
        <a href="mailto:contact@quantgems.com">聯絡我們</a>
      </nav>
    </footer>
  </div>
</template>
