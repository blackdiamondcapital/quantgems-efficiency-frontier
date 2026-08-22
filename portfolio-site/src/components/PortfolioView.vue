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
const hoveredPoint = ref(null)

const activePresetKey = computed(() => Object.entries(PRESETS).find(([, item]) => (
  item.symbols.length === symbols.value.length
  && item.symbols.every((symbol) => symbols.value.includes(symbol))
))?.[0] || '')

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
    .filter((row) => Math.abs(row.weight) >= 0.0005)
    .sort((a, b) => b.weight - a.weight)
})

const comparisonRows = computed(() => {
  if (!result.value) return []
  return [
    { key: 'tangency', label: '最大夏普', ...result.value.tangency },
    { key: 'gmv', label: '最小變異數', ...result.value.gmv },
  ]
})

const portfolioSummary = computed(() => {
  const rows = weightRows.value.filter((row) => row.weight > 0.0005)
  if (!rows.length) return null
  const topWeight = rows[0].weight
  const top3Weight = rows.slice(0, 3).reduce((sum, row) => sum + row.weight, 0)
  const effectiveHoldings = 1 / rows.reduce((sum, row) => sum + row.weight ** 2, 0)
  const level = top3Weight >= 0.8 ? '集中' : top3Weight >= 0.6 ? '中度集中' : '分散'
  return { holdings: rows.length, topWeight, top3Weight, effectiveHoldings, level }
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
  const xTicks = Array.from({ length: 5 }, (_, i) => {
    const value = (maxVol * i) / 4
    return { value, pos: x(value) }
  })
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const value = minRet + ((maxRet - minRet) * i) / 4
    return { value, pos: y(value) }
  })
  return { x, y, path, cal, maxVol, minRet, maxRet, xTicks, yTicks }
})

function pct(v, digits = 1) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return `${(Number(v) * 100).toFixed(digits)}%`
}

function sharpe(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  return Number(v).toFixed(2)
}

function displaySymbol(symbol) {
  return String(symbol || '').replace(/\.(TW|TWO)$/i, '')
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
      <div>
        <p class="kicker">Portfolio Intelligence · Markowitz</p>
        <h2>從風險與報酬出發，<span>找到適合你的投資組合。</span></h2>
        <p class="lead">
          以歷史報酬與共變異數估計投資組合，互動比較最大夏普、最小變異數與效率前緣上的每一個解。
        </p>
      </div>
      <div class="hero-badges" aria-label="模型特點">
        <span>台股資料</span><span>年化估計</span><span>即時計算</span>
      </div>
    </div>

    <form class="panel controls" @submit.prevent="run">
      <div class="control-head">
        <div><span class="step">01</span><b>建立投資範圍</b></div>
        <span>{{ symbols.length }} / 16 檔</span>
      </div>
      <div class="presets">
        <button v-for="(item, key) in PRESETS" :key="key" type="button" class="chip" :class="{ active: activePresetKey === key }" @click="applyPreset(key)">
          {{ item.label }}
        </button>
      </div>
      <div class="universe">
        <button v-for="sym in symbols" :key="sym" type="button" class="tag" @click="removeSymbol(sym)">
          {{ displaySymbol(sym) }} <span aria-hidden="true">×</span>
        </button>
        <div class="search-box">
          <input v-model="query" placeholder="加入代號或名稱" autocomplete="off" />
          <ul v-if="suggestions.length" class="suggest">
            <li v-for="item in suggestions" :key="item.symbol">
              <button type="button" @click="addSymbol(item)">{{ displaySymbol(item.symbol) }}　{{ item.name }}</button>
            </li>
          </ul>
        </div>
      </div>
      <div class="control-head model-head">
        <div><span class="step">02</span><b>設定模型參數</b></div>
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

    <section v-if="result" class="overview" aria-label="模型結果摘要">
      <div class="overview-head">
        <div><span class="step">03</span><b>比較最佳化結果</b></div>
        <span v-if="result.startDate">{{ result.startDate }} — {{ result.endDate }} · {{ result.observations }} 個共同交易日</span>
      </div>
      <div class="comparison-grid">
        <button v-for="row in comparisonRows" :key="row.key" type="button" class="comparison-card" :class="{ active: selectedKey === row.key }" @click="selectedKey = row.key">
          <span class="comparison-label">{{ row.label }}</span>
          <strong>{{ pct(row.ret) }}</strong>
          <span>年化報酬</span>
          <dl><div><dt>波動</dt><dd>{{ pct(row.vol) }}</dd></div><div><dt>夏普</dt><dd>{{ sharpe(row.sharpe) }}</dd></div></dl>
        </button>
        <div v-if="portfolioSummary" class="insight-card">
          <span class="comparison-label">目前組合觀察</span>
          <strong>{{ portfolioSummary.level }}</strong>
          <p>前 3 大持股占 {{ pct(portfolioSummary.top3Weight) }}，有效持股約 {{ portfolioSummary.effectiveHoldings.toFixed(1) }} 檔。</p>
        </div>
      </div>
    </section>

    <div v-if="result && chart" class="stage">
      <figure class="chart-card">
        <div class="card-head"><div><span>RISK / RETURN MAP</span><h3>效率前緣</h3></div><span>點擊前緣選擇配置</span></div>
        <svg viewBox="0 0 640 360" role="img" aria-label="效率前緣圖：橫軸風險、縱軸期望報酬">
          <text x="320" y="18" text-anchor="middle" class="chart-title">效率前緣（年化）</text>
          <g v-for="tick in chart.xTicks" :key="`x-${tick.value}`">
            <line :x1="tick.pos" y1="28" :x2="tick.pos" y2="320" class="grid-line" />
            <text :x="tick.pos" y="337" text-anchor="middle" class="tick-label">{{ pct(tick.value, 0) }}</text>
          </g>
          <g v-for="tick in chart.yTicks" :key="`y-${tick.value}`">
            <line x1="56" :y1="tick.pos" x2="616" :y2="tick.pos" class="grid-line" />
            <text x="49" :y="tick.pos + 4" text-anchor="end" class="tick-label">{{ pct(tick.value, 0) }}</text>
          </g>
          <line x1="56" y1="320" x2="616" y2="320" class="axis" />
          <line x1="56" y1="28" x2="56" y2="320" class="axis" />
          <text x="336" y="354" text-anchor="middle" class="axis-label">年化標準差</text>
          <text x="12" y="180" transform="rotate(-90 12 180)" text-anchor="middle" class="axis-label">年化平均報酬</text>
          <path :d="chart.cal" class="cal" />
          <path :d="chart.path" class="frontier" />
          <circle
            v-for="(a, i) in result.assets"
            :key="'a'+i"
            :cx="chart.x(a.vol)"
            :cy="chart.y(a.ret)"
            r="5"
            class="asset"
            tabindex="0"
            @mouseenter="hoveredPoint = { x: chart.x(a.vol), y: chart.y(a.ret), label: `${displaySymbol(a.symbol)} ${a.name}`, ret: a.ret, vol: a.vol }"
            @mouseleave="hoveredPoint = null"
            @focus="hoveredPoint = { x: chart.x(a.vol), y: chart.y(a.ret), label: `${displaySymbol(a.symbol)} ${a.name}`, ret: a.ret, vol: a.vol }"
            @blur="hoveredPoint = null"
          >
            <title>{{ displaySymbol(a.symbol) }} {{ a.name }}</title>
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
            @mouseenter="hoveredPoint = { x: chart.x(p.vol), y: chart.y(p.ret), label: `前緣組合 ${i + 1}`, ret: p.ret, vol: p.vol }"
            @mouseleave="hoveredPoint = null"
          />
          <circle :cx="chart.x(result.gmv.vol)" :cy="chart.y(result.gmv.ret)" r="8" class="gmv" @click="selectedKey = 'gmv'" @mouseenter="hoveredPoint = { x: chart.x(result.gmv.vol), y: chart.y(result.gmv.ret), label: '全球最小變異數', ret: result.gmv.ret, vol: result.gmv.vol }" @mouseleave="hoveredPoint = null" />
          <circle :cx="chart.x(result.tangency.vol)" :cy="chart.y(result.tangency.ret)" r="8" class="tan" @click="selectedKey = 'tangency'" @mouseenter="hoveredPoint = { x: chart.x(result.tangency.vol), y: chart.y(result.tangency.ret), label: '最大夏普組合', ret: result.tangency.ret, vol: result.tangency.vol }" @mouseleave="hoveredPoint = null" />
          <g v-if="hoveredPoint" class="chart-tooltip" pointer-events="none">
            <rect :x="Math.min(hoveredPoint.x + 10, 430)" :y="Math.max(hoveredPoint.y - 58, 30)" width="190" height="52" rx="8" />
            <text :x="Math.min(hoveredPoint.x + 20, 440)" :y="Math.max(hoveredPoint.y - 36, 52)" class="tooltip-title">{{ hoveredPoint.label }}</text>
            <text :x="Math.min(hoveredPoint.x + 20, 440)" :y="Math.max(hoveredPoint.y - 17, 71)" class="tooltip-value">報酬 {{ pct(hoveredPoint.ret) }} · 波動 {{ pct(hoveredPoint.vol) }}</text>
          </g>
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
              <b>{{ displaySymbol(row.symbol) }}</b>
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
            <th>平均數</th>
            <th>標準差</th>
            <th>夏普</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in result.assets" :key="a.symbol">
            <td>
              <button type="button" class="sym" @click="openChart(a.symbol)">
                <b>{{ displaySymbol(a.symbol) }}</b>
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
.workbench { display: grid; gap: 22px; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 24px;
  padding: 18px 4px 10px;
}
.hero h2 {
  margin: 0 0 10px;
  max-width: 52rem;
  font-size: clamp(1.7rem, 4.5vw, 3.25rem);
  line-height: 1.13;
  letter-spacing: -0.035em;
}
.hero h2 span { color: #fde68a; }
.hero-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.hero-badges span {
  padding: 7px 10px;
  border: 1px solid rgba(103,232,249,.2);
  border-radius: 999px;
  background: rgba(8,18,28,.5);
  color: #a5f3fc;
  font-size: .72rem;
  white-space: nowrap;
}
.kicker {
  margin: 0 0 8px;
  color: #fde68a;
  letter-spacing: 0.12em;
  font-size: 0.74rem;
  font-weight: 800;
}
.lead { margin: 0; color: #94a3b8; max-width: 46rem; font-size: clamp(.9rem, 2vw, 1.05rem); line-height: 1.75; }

.panel, .overview {
  padding: 18px;
  border-radius: 20px;
  border: 1px solid rgba(148,163,184,.16);
  background: linear-gradient(145deg, rgba(13,27,41,.82), rgba(7,17,27,.7));
  box-shadow: 0 18px 45px rgba(0,0,0,.14);
}
.control-head, .overview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: #94a3b8;
  font-size: .78rem;
}
.control-head > div, .overview-head > div { display: flex; align-items: center; gap: 9px; color: #e2e8f0; font-size: .92rem; }
.step { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: rgba(34,211,238,.12); color: #67e8f9; font-size: .7rem; font-weight: 900; }
.model-head { margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(148,163,184,.12); }
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
.chip, .tag { padding: 0 12px; transition: border-color .2s ease, background .2s ease, transform .2s ease; }
.chip:hover, .tag:hover { transform: translateY(-1px); border-color: rgba(103,232,249,.55); }
.chip.active { background: rgba(34,211,238,.13); border-color: rgba(34,211,238,.55); color: #cffafe; }
.tag { background: rgba(253, 230, 138, 0.08); border-color: rgba(253,230,138,.28); }
.btn {
  padding: 0 18px;
  min-height: 44px;
  font-weight: 900;
  background: linear-gradient(135deg, #f8fafc, #a5f3fc);
  color: #07111c;
  border-color: transparent;
  box-shadow: 0 8px 24px rgba(34,211,238,.13);
}
.btn:disabled { opacity: .55; cursor: wait; }
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
.err { margin: 12px 0 0; padding: 10px 12px; border: 1px solid rgba(251,191,36,.25); border-radius: 10px; background: rgba(120,53,15,.18); color: #fde68a; }

.overview-head { margin-bottom: 14px; }
.comparison-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)) minmax(210px, .85fr); gap: 10px; }
.comparison-card, .insight-card {
  min-width: 0;
  padding: 15px;
  border: 1px solid rgba(148,163,184,.16);
  border-radius: 15px;
  background: rgba(5,15,24,.55);
  color: #e2e8f0;
  text-align: left;
}
.comparison-card { cursor: pointer; transition: border-color .2s ease, transform .2s ease, background .2s ease; }
.comparison-card:hover { transform: translateY(-2px); border-color: rgba(103,232,249,.38); }
.comparison-card.active { border-color: rgba(253,230,138,.52); background: linear-gradient(145deg, rgba(253,230,138,.09), rgba(5,15,24,.7)); }
.comparison-label { display: block; color: #94a3b8; font-size: .75rem; font-weight: 700; }
.comparison-card > strong, .insight-card > strong { display: block; margin-top: 8px; color: #f8fafc; font-size: clamp(1.5rem, 3vw, 2rem); }
.comparison-card > span:nth-child(3) { color: #94a3b8; font-size: .72rem; }
.comparison-card dl { display: flex; gap: 22px; margin: 14px 0 0; }
.comparison-card dl div { display: flex; gap: 6px; }
.comparison-card dt { color: #64748b; }
.comparison-card dd { margin: 0; font-weight: 800; }
.insight-card { background: linear-gradient(145deg, rgba(8,47,73,.35), rgba(5,15,24,.65)); }
.insight-card > strong { color: #67e8f9; }
.insight-card p { margin: 8px 0 0; color: #94a3b8; font-size: .8rem; line-height: 1.6; }

.stage { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(280px, 0.7fr); gap: 14px; }
.chart-card, .result-card {
  margin: 0;
  border-radius: 20px;
  border: 1px solid rgba(148,163,184,.14);
  background: linear-gradient(155deg, rgba(11,25,38,.82), rgba(5,14,23,.7));
  padding: 15px 16px 16px;
}
.card-head { display: flex; justify-content: space-between; align-items: end; gap: 12px; padding: 2px 4px 8px; }
.card-head span { color: #64748b; font-size: .67rem; letter-spacing: .1em; }
.card-head h3 { margin: 2px 0 0; font-size: 1.1rem; }
svg { width: 100%; height: auto; display: block; overflow: visible; }
.chart-title { fill: transparent; font-size: 1px; }
.grid-line { stroke: rgba(148,163,184,.09); stroke-width: 1; }
.tick-label { fill: #64748b; font-size: 9px; }
.axis { stroke: rgba(148,163,184,.3); }
.axis-label { fill: #94a3b8; font-size: 10px; }
.frontier { fill: none; stroke: #fde68a; stroke-width: 2.5; filter: drop-shadow(0 0 5px rgba(253,230,138,.18)); }
.cal { fill: none; stroke: #67e8f9; stroke-width: 1.4; stroke-dasharray: 5 5; }
.asset { fill: #64748b; cursor: help; transition: r .15s ease, fill .15s ease; }
.asset:hover, .asset:focus { fill: #cbd5e1; outline: none; }
.fdot { fill: rgba(253,230,138,.38); cursor: pointer; transition: r .15s ease, fill .15s ease; }
.fdot:hover, .fdot.active { fill: #f8fafc; }
.gmv { fill: #22d3ee; stroke: #083344; stroke-width: 2; cursor: pointer; }
.tan { fill: #f59e0b; stroke: #451a03; stroke-width: 2; cursor: pointer; }
.chart-tooltip rect { fill: rgba(3,11,18,.96); stroke: rgba(103,232,249,.35); }
.tooltip-title { fill: #f8fafc; font-size: 10px; font-weight: 800; }
.tooltip-value { fill: #94a3b8; font-size: 9px; }
figcaption { color: #94a3b8; font-size: 0.76rem; line-height: 1.55; margin-top: 8px; padding: 0 4px; }

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
  .comparison-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .insight-card { grid-column: 1 / -1; }
}
@media (max-width: 767px) {
  .workbench { gap: 14px; }
  .hero { grid-template-columns: 1fr; padding-top: 6px; }
  .hero h2 { font-size: clamp(1.8rem, 9vw, 2.6rem); }
  .hero-badges { justify-content: flex-start; }
  .panel, .overview { padding: 14px; border-radius: 16px; }
  .opts { flex-direction: column; align-items: stretch; }
  .btn { width: 100%; }
  .overview-head { align-items: flex-start; flex-direction: column; }
  .comparison-grid { grid-template-columns: 1fr; }
  .insight-card { grid-column: auto; }
  .comparison-card > strong, .insight-card > strong { font-size: 1.65rem; }
  .chart-card, .result-card { padding: 12px; border-radius: 16px; }
  .card-head > span { display: none; }
  .weights li { grid-template-columns: 5.5rem 1fr 3.2rem; }
}
</style>
