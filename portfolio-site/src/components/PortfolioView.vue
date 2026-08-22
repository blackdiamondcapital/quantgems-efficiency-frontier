<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { MAIN_SITE_URL } from '../lib/siteLinks'
import { computeFrontier, searchSymbols } from '../services/api'

const PRESETS = {
  mega: {
    label: '權值股',
    symbols: ['2330', '2317', '2454', '2412', '2308', '2881', '2882', '1301'],
  },
  semi: {
    label: '半導體',
    symbols: ['2330', '2454', '2303', '3711', '3034', '2379', '2408', '3443'],
  },
  finance: {
    label: '金融',
    symbols: ['2881', '2882', '2891', '2886', '2884', '2885', '2880', '2892'],
  },
}

const STORAGE_KEY = 'qg_frontier_universe'

const symbols = ref([...PRESETS.mega.symbols])
const lookback = ref(504)
const rfPct = ref(1.5)
const longOnly = ref(true)
const query = ref('')
const suggestions = ref([])
const loading = ref(false)
const error = ref('')
const result = ref(null)
const selectedKey = ref('tangency')
const selectedIndex = ref(-1)

const selected = computed(() => {
  if (!result.value) return null
  if (selectedKey.value === 'gmv') return { key: 'gmv', title: '全球最小變異數', ...result.value.gmv }
  if (selectedKey.value === 'point' && result.value.frontier[selectedIndex.value]) {
    return { key: 'point', title: '前緣上的組合', ...result.value.frontier[selectedIndex.value] }
  }
  return { key: 'tangency', title: '最大夏普（切線組合）', ...result.value.tangency }
})

const weightRows = computed(() => {
  if (!selected.value) return []
  return Object.entries(selected.value.weights)
    .map(([symbol, weight]) => ({
      symbol,
      name: result.value?.assets.find((a) => a.symbol === symbol)?.name || symbol,
      weight,
    }))
    .sort((a, b) => b.weight - a.weight)
})

const chart = computed(() => {
  const data = result.value
  if (!data) return null
  const pts = [
    ...data.assets.map((a) => ({ vol: a.vol, ret: a.ret })),
    ...data.frontier,
    data.gmv,
    data.tangency,
    { vol: 0, ret: data.rf },
  ]
  const maxVol = Math.max(...pts.map((p) => p.vol), 0.08)
  const minRet = Math.min(...pts.map((p) => p.ret), data.rf, 0)
  const maxRet = Math.max(...pts.map((p) => p.ret), data.rf, 0.08)
  const padX = maxVol * 0.08
  const padY = (maxRet - minRet) * 0.12 || 0.02
  const x0 = 56
  const y0 = 28
  const w = 560
  const h = 292
  const x = (vol) => x0 + ((vol) / (maxVol + padX)) * w
  const y = (ret) => y0 + h - ((ret - (minRet - padY)) / ((maxRet + padY) - (minRet - padY))) * h
  const path = data.frontier.map((p, i) => `${i ? 'L' : 'M'}${x(p.vol).toFixed(1)},${y(p.ret).toFixed(1)}`).join(' ')
  const cal = `M${x(0).toFixed(1)},${y(data.rf).toFixed(1)} L${x(data.tangency.vol).toFixed(1)},${y(data.tangency.ret).toFixed(1)}`
  return { x, y, path, cal, maxVol, minRet, maxRet }
})

function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

function sharpe(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toFixed(2)
}

function openChart(symbol) {
  window.open(`${MAIN_SITE_URL}/?symbol=${encodeURIComponent(symbol)}`, '_blank', 'noopener,noreferrer')
}

function applyPreset(key) {
  symbols.value = [...PRESETS[key].symbols]
}

function removeSymbol(sym) {
  symbols.value = symbols.value.filter((s) => s !== sym)
}

function addSymbol(item) {
  const next = String(item.symbol || '').toUpperCase()
  if (!next || symbols.value.includes(next) || symbols.value.length >= 16) return
  symbols.value = [...symbols.value, next]
  query.value = ''
  suggestions.value = []
}

async function onSearch() {
  const q = query.value.trim()
  if (!q) {
    suggestions.value = []
    return
  }
  try {
    const json = await searchSymbols(q)
    suggestions.value = json.data || []
  } catch {
    suggestions.value = []
  }
}

let searchTimer = 0
watch(query, () => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(onSearch, 180)
})

async function run() {
  loading.value = true
  error.value = ''
  try {
    const json = await computeFrontier({
      symbols: symbols.value,
      lookback: lookback.value,
      rf: Number(rfPct.value) / 100,
      longOnly: longOnly.value,
    })
    result.value = json.data
    selectedKey.value = 'tangency'
    selectedIndex.value = -1
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols.value)) } catch {}
  } catch (e) {
    error.value = e.message || '計算失敗'
  } finally {
    loading.value = false
  }
}

function pickFrontier(idx) {
  selectedKey.value = 'point'
  selectedIndex.value = idx
}

onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (Array.isArray(saved) && saved.length >= 2) symbols.value = saved.map(String)
  } catch {}
  run()
})
</script>

<template>
  <section class="workbench">
    <div class="hero">
      <p class="kicker">Markowitz · Mean–Variance</p>
      <h2>用歷史報酬與共變異數，畫出台股的效率前緣。</h2>
      <p class="lead">
        給定標的集合，估計年化期望報酬 μ 與共變異數 Σ，求解最小風險組合、最大夏普切線組合，以及風險–報酬前緣。僅供研究，不代表未來績效。
      </p>
    </div>

    <form class="panel controls" @submit.prevent="run">
      <div class="presets">
        <button v-for="(item, key) in PRESETS" :key="key" type="button" class="chip" @click="applyPreset(key)">
          {{ item.label }}
        </button>
      </div>
      <div class="universe">
        <button v-for="sym in symbols" :key="sym" type="button" class="tag" @click="removeSymbol(sym)">
          {{ sym }} <span aria-hidden="true">×</span>
        </button>
        <div class="search-box">
          <input v-model="query" placeholder="加入代號或名稱" autocomplete="off" />
          <ul v-if="suggestions.length" class="suggest">
            <li v-for="item in suggestions" :key="item.symbol">
              <button type="button" @click="addSymbol(item)">{{ item.symbol }}　{{ item.name }}</button>
            </li>
          </ul>
        </div>
      </div>
      <div class="opts">
        <label>
          回顧期
          <select v-model.number="lookback">
            <option :value="252">約 1 年（252 日）</option>
            <option :value="504">約 2 年（504 日）</option>
            <option :value="756">約 3 年（756 日）</option>
          </select>
        </label>
        <label>
          無風險利率
          <span class="rf">
            <input v-model.number="rfPct" type="number" min="0" max="10" step="0.1" />
            <em>%</em>
          </span>
        </label>
        <label class="check">
          <input v-model="longOnly" type="checkbox" />
          不可放空（權重 ≥ 0）
        </label>
        <button class="btn" type="submit" :disabled="loading || symbols.length < 2">
          {{ loading ? '估計中…' : '估計效率前緣' }}
        </button>
      </div>
      <p v-if="error" class="err">{{ error }}</p>
    </form>

    <div v-if="result && chart" class="stage">
      <figure class="chart-card">
        <svg viewBox="0 0 640 360" role="img" aria-label="效率前緣圖：橫軸風險、縱軸期望報酬">
          <text x="320" y="18" text-anchor="middle" class="chart-title">效率前緣（年化）</text>
          <line x1="56" y1="320" x2="616" y2="320" class="axis" />
          <line x1="56" y1="28" x2="56" y2="320" class="axis" />
          <text x="336" y="350" text-anchor="middle" class="axis-label">風險 σ</text>
          <text x="18" y="180" transform="rotate(-90 18 180)" class="axis-label">期望報酬 μ</text>
          <path :d="chart.cal" class="cal" />
          <path :d="chart.path" class="frontier" />
          <circle
            v-for="(a, i) in result.assets"
            :key="'a'+i"
            :cx="chart.x(a.vol)"
            :cy="chart.y(a.ret)"
            r="4.2"
            class="asset"
          >
            <title>{{ a.symbol }} {{ a.name }}</title>
          </circle>
          <circle
            v-for="(p, i) in result.frontier"
            :key="'f'+i"
            :cx="chart.x(p.vol)"
            :cy="chart.y(p.ret)"
            r="5"
            class="fdot"
            :class="{ active: selectedKey === 'point' && selectedIndex === i }"
            @click="pickFrontier(i)"
          />
          <circle :cx="chart.x(result.gmv.vol)" :cy="chart.y(result.gmv.ret)" r="7" class="gmv" @click="selectedKey = 'gmv'" />
          <circle :cx="chart.x(result.tangency.vol)" :cy="chart.y(result.tangency.ret)" r="7" class="tan" @click="selectedKey = 'tangency'" />
        </svg>
        <figcaption>
          灰點＝個股；金線＝效率前緣；青點＝最小變異數；琥珀點＝最大夏普。虛線為資本配置線（CAL）。
          <span v-if="result.startDate">樣本 {{ result.startDate }}～{{ result.endDate }}，共同交易日 {{ result.observations }}。</span>
        </figcaption>
      </figure>

      <aside class="result-card">
        <div class="tabs">
          <button type="button" :class="{ active: selectedKey === 'tangency' }" @click="selectedKey = 'tangency'">最大夏普</button>
          <button type="button" :class="{ active: selectedKey === 'gmv' }" @click="selectedKey = 'gmv'">最小變異數</button>
        </div>
        <p class="pick-title">{{ selected?.title }}</p>
        <dl class="stats">
          <div><dt>期望報酬</dt><dd>{{ pct(selected?.ret) }}</dd></div>
          <div><dt>波動</dt><dd>{{ pct(selected?.vol) }}</dd></div>
          <div><dt>夏普</dt><dd>{{ sharpe(selected?.sharpe) }}</dd></div>
        </dl>
        <ul class="weights">
          <li v-for="row in weightRows" :key="row.symbol">
            <button type="button" class="sym" @click="openChart(row.symbol)">
              <b>{{ row.symbol }}</b>
              <small>{{ row.name }}</small>
            </button>
            <i :style="{ width: `${Math.max(2, row.weight * 100)}%` }" />
            <span>{{ (row.weight * 100).toFixed(1) }}%</span>
          </li>
        </ul>
      </aside>
    </div>

    <div v-if="result" class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>標的</th>
            <th>μ</th>
            <th>σ</th>
            <th>夏普</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in result.assets" :key="a.symbol">
            <td>
              <button type="button" class="sym" @click="openChart(a.symbol)">
                <b>{{ a.symbol }}</b>
                <small>{{ a.name }}</small>
              </button>
            </td>
            <td>{{ pct(a.ret) }}</td>
            <td>{{ pct(a.vol) }}</td>
            <td>{{ sharpe(a.sharpe) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.workbench { display: grid; gap: 18px; }
.hero h2 {
  margin: 0 0 8px;
  font-size: clamp(1.4rem, 4vw, 2.05rem);
  line-height: 1.25;
}
.kicker {
  margin: 0 0 8px;
  color: #fde68a;
  letter-spacing: 0.12em;
  font-size: 0.74rem;
  font-weight: 800;
}
.lead { margin: 0; color: #94a3b8; max-width: 44rem; }

.panel {
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.16);
  background: rgba(8,18,28,.55);
}
.presets, .universe, .opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.universe { margin: 10px 0; }
.chip, .tag, .btn, .tabs button, .sym {
  min-height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,.28);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.chip, .tag { padding: 0 12px; }
.tag { background: rgba(253, 230, 138, 0.08); border-color: rgba(253,230,138,.28); }
.btn {
  padding: 0 16px;
  font-weight: 800;
  background: #f8fafc;
  color: #0b1220;
  border-color: transparent;
}
.opts label { display: grid; gap: 4px; color: #94a3b8; font-size: 0.78rem; }
.opts select, .opts input[type="number"] {
  min-height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(148,163,184,.24);
  background: #0b1724;
  color: #e2e8f0;
  padding: 0 10px;
}
.rf { display: flex; align-items: center; gap: 6px; }
.rf em { font-style: normal; color: #cbd5e1; }
.check { display: flex !important; align-items: center; gap: 8px; min-height: 40px; }
.search-box { position: relative; flex: 1 1 180px; }
.search-box input {
  width: 100%;
  min-height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(148,163,184,.24);
  background: #0b1724;
  color: #e2e8f0;
  padding: 0 12px;
}
.suggest {
  position: absolute; z-index: 8; left: 0; right: 0; top: calc(100% + 4px);
  margin: 0; padding: 6px; list-style: none;
  border-radius: 12px; background: #0b1724; border: 1px solid rgba(148,163,184,.2);
}
.suggest button { width: 100%; text-align: left; border: 0; background: none; color: inherit; min-height: 40px; cursor: pointer; }
.err { margin: 8px 0 0; color: #fde68a; }

.stage { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.7fr); gap: 14px; }
.chart-card, .result-card {
  border-radius: 16px;
  border: 1px solid rgba(148,163,184,.14);
  background: rgba(8,18,28,.6);
  padding: 10px 12px 12px;
}
svg { width: 100%; height: auto; display: block; }
.chart-title { fill: #e2e8f0; font-size: 13px; font-weight: 700; }
.axis { stroke: rgba(148,163,184,.35); }
.axis-label { fill: #94a3b8; font-size: 11px; }
.frontier { fill: none; stroke: #fde68a; stroke-width: 2.2; }
.cal { fill: none; stroke: #67e8f9; stroke-width: 1.4; stroke-dasharray: 5 5; }
.asset { fill: #64748b; }
.fdot { fill: rgba(253,230,138,.35); cursor: pointer; }
.fdot.active { fill: #f8fafc; }
.gmv { fill: #22d3ee; cursor: pointer; }
.tan { fill: #f59e0b; cursor: pointer; }
figcaption { color: #94a3b8; font-size: 0.78rem; margin-top: 8px; }

.tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.tabs button { padding: 0 12px; }
.tabs button.active { background: #f8fafc; color: #0b1220; border-color: transparent; font-weight: 800; }
.pick-title { margin: 12px 0 8px; font-weight: 800; }
.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 0 0 12px; }
.stats dt { color: #94a3b8; font-size: 0.74rem; }
.stats dd { margin: 4px 0 0; font-weight: 800; }
.weights { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.weights li { display: grid; grid-template-columns: 5.2rem 1fr 3.2rem; gap: 8px; align-items: center; }
.weights i { display: block; height: 7px; border-radius: 99px; background: linear-gradient(90deg, #38bdf8, #fde68a); }
.sym {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  border: 0; background: none; padding: 0; min-height: 0;
}
.sym small { color: #94a3b8; font-size: 0.72rem; }

.table-wrap { overflow-x: auto; border: 1px solid rgba(148,163,184,.14); border-radius: 14px; }
table { width: 100%; border-collapse: collapse; min-width: 520px; }
th, td { padding: 11px 10px; text-align: right; border-bottom: 1px solid rgba(148,163,184,.1); }
th:first-child, td:first-child { text-align: left; }
th { color: #94a3b8; font-size: 0.78rem; }

@media (max-width: 1023px) {
  .stage { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  .opts { flex-direction: column; align-items: stretch; }
}
</style>
