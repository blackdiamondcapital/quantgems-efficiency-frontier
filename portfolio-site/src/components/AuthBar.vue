<script setup>
import { useAuth } from '../stores/auth'
import { buildOAuthStartUrl } from '../lib/oauthStart'
import { MAIN_SITE_URL, PRICING_URL } from '../lib/siteLinks'

const {
  isAuthenticated,
  displayName,
  planLabel,
  loading,
  logout,
} = useAuth()

function handleGoogleLogin() {
  window.location.href = buildOAuthStartUrl('google')
}

async function handleLogout() {
  await logout()
}
</script>

<template>
  <div class="auth-bar">
    <a
      class="btn-auth main-link"
      :href="MAIN_SITE_URL"
      target="_blank"
      rel="noopener noreferrer"
    >QuantGems® 主站</a>

    <template v-if="loading">
      <span class="user-pill">驗證中…</span>
    </template>
    <template v-else-if="isAuthenticated">
      <span class="auth-user">
        <span class="auth-avatar" aria-hidden="true">{{ String(displayName || 'Q').slice(0, 1).toUpperCase() }}</span>
        <span class="auth-name">{{ displayName }}</span>
        <span class="plan-pill">{{ planLabel }}</span>
      </span>
      <a
        class="btn-auth subscribe"
        :href="PRICING_URL"
        target="_blank"
        rel="noopener noreferrer"
      >訂閱</a>
      <button type="button" class="btn-auth ghost" @click="handleLogout">登出</button>
    </template>
    <template v-else>
      <a
        class="btn-auth subscribe"
        :href="PRICING_URL"
        target="_blank"
        rel="noopener noreferrer"
      >訂閱</a>
      <button type="button" class="btn-auth google" @click="handleGoogleLogin">
        <svg class="g-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        <span class="login-label-full">Google 登入</span>
        <span class="login-label-short">登入</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.auth-bar {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.auth-user {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 12rem;
  padding: 3px 5px 3px 3px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.52);
}

.auth-avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: 0 0 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #0ea5e9, #2dd4bf);
  color: #02121c;
  font-size: 0.7rem;
  font-weight: 900;
}

.auth-name {
  font-size: 0.82rem;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.plan-pill,
.user-pill {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  flex-shrink: 0;
}

.plan-pill {
  color: #041311;
  background: linear-gradient(135deg, #67e8f9, #5eead4);
}

.user-pill {
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.7);
  color: #e2e8f0;
}

a.btn-auth {
  text-decoration: none;
}

.btn-auth {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 700;
  border: 1px solid transparent;
  cursor: pointer;
  background: transparent;
  color: #e2e8f0;
  min-height: 44px;
}

.btn-auth.main-link {
  color: #93c5fd;
  border-color: transparent;
  padding-inline: 0.35rem;
}

.btn-auth.main-link:hover {
  color: #bfdbfe;
}

.btn-auth.subscribe {
  background: rgba(45, 212, 191, 0.12);
  border-color: rgba(45, 212, 191, 0.45);
  color: #ccfbf1;
}

.btn-auth.subscribe:hover {
  background: rgba(45, 212, 191, 0.22);
  color: #fff;
}

.btn-auth.ghost {
  border-color: rgba(148, 163, 184, 0.35);
  color: #cbd5e1;
}

.btn-auth.ghost:hover {
  background: rgba(148, 163, 184, 0.12);
}

.btn-auth.google {
  background: #fff;
  border-color: rgba(148, 163, 184, 0.35);
  color: #1f2937;
}

.btn-auth.google:hover {
  background: #f8fafc;
}

.g-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.login-label-short { display: none; }

@media (max-width: 700px) {
  .auth-bar { justify-content: flex-start; }
  .auth-user { max-width: 7.5rem; }
  .auth-name,
  .plan-pill,
  .user-pill,
  .btn-auth { font-size: 0.86rem; }
  .login-label-full { display: none; }
  .login-label-short { display: inline; }
  .btn-auth.main-link { padding-inline: 0.45rem; }
}
</style>
