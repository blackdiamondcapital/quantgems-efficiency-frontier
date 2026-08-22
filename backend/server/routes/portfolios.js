import express from 'express';
import { pool } from '../pool.js';
import { requireAuth } from '../middleware/auth.js';
import { alignReturnMatrix, buildFrontier, toDecimalReturns } from '../lib/meanVariance.js';

const router = express.Router();

const MAX_PORTFOLIOS = 8;
const MAX_HOLDINGS = 60;
const MAX_NAME = 40;

let ensured = false;

async function ensurePortfolioTables() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_portfolios (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_portfolio_holdings (
      id BIGSERIAL PRIMARY KEY,
      portfolio_id BIGINT NOT NULL REFERENCES user_portfolios(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL,
      shares NUMERIC(18, 4) NOT NULL,
      avg_cost NUMERIC(18, 4) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (portfolio_id, symbol)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS user_portfolios_user_id_idx ON user_portfolios(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS user_portfolio_holdings_portfolio_id_idx ON user_portfolio_holdings(portfolio_id)');
  ensured = true;
}

function normalizeSymbol(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^0-9A-Z.^]/g, '').slice(0, 16);
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function userIdOf(req) {
  const id = Number(req.user?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function parseSymbolsParam(raw) {
  const list = String(raw || '')
    .split(/[\s,]+/)
    .map(normalizeSymbol)
    .filter(Boolean);
  return [...new Set(list)].slice(0, 80);
}

async function fetchQuotes(symbols) {
  if (!symbols.length) return { asOfDate: null, quotes: [] };
  const q = await pool.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (symbol)
        symbol, date, close_price
      FROM tw_stock_prices
      WHERE symbol = ANY($1::text[])
      ORDER BY symbol, date DESC
    ),
    prev AS (
      SELECT DISTINCT ON (p.symbol)
        p.symbol, p.close_price
      FROM tw_stock_prices p
      JOIN latest l ON l.symbol = p.symbol AND p.date < l.date
      ORDER BY p.symbol, p.date DESC
    )
    SELECT
      l.symbol,
      l.date,
      l.close_price::float8 AS close,
      prev.close_price::float8 AS prev_close,
      COALESCE(s.name, s.short_name, l.symbol) AS name,
      COALESCE(s.short_name, s.name, '') AS short_name,
      COALESCE(s.market, '') AS market
    FROM latest l
    LEFT JOIN prev ON prev.symbol = l.symbol
    LEFT JOIN tw_stock_symbols s ON s.symbol = l.symbol
    `,
    [symbols]
  );
  const quotes = (q.rows || []).map((row) => {
    const close = toNum(row.close);
    const prevClose = toNum(row.prev_close);
    const change = close != null && prevClose != null ? close - prevClose : null;
    const changePct = change != null && prevClose ? (change / prevClose) * 100 : null;
    return {
      symbol: row.symbol,
      name: row.name,
      shortName: row.short_name,
      market: row.market || '',
      close,
      prevClose,
      change,
      changePct,
      asOfDate: row.date ? String(row.date).slice(0, 10) : null,
    };
  });
  const asOfDate = quotes.find((item) => item.asOfDate)?.asOfDate || null;
  return { asOfDate, quotes };
}

function enrichHoldings(holdings, quotes) {
  const map = new Map(quotes.map((q) => [q.symbol, q]));
  return holdings.map((h) => {
    const quote = map.get(h.symbol) || null;
    const shares = toNum(h.shares, 0);
    const avgCost = toNum(h.avg_cost, 0);
    const close = quote?.close ?? null;
    const cost = shares * avgCost;
    const marketValue = close != null ? shares * close : null;
    const pnl = marketValue != null ? marketValue - cost : null;
    const pnlPct = pnl != null && cost > 0 ? (pnl / cost) * 100 : null;
    const dayPnl = quote?.change != null ? shares * quote.change : null;
    return {
      id: Number(h.id),
      symbol: h.symbol,
      name: quote?.name || h.symbol,
      market: quote?.market || '',
      shares,
      avgCost,
      close,
      change: quote?.change ?? null,
      changePct: quote?.changePct ?? null,
      cost,
      marketValue,
      pnl,
      pnlPct,
      dayPnl,
      asOfDate: quote?.asOfDate || null,
    };
  });
}

function summarize(rows) {
  const cost = rows.reduce((s, r) => s + (r.cost || 0), 0);
  const marketValue = rows.reduce((s, r) => s + (r.marketValue || 0), 0);
  const pnl = marketValue - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
  const dayPnl = rows.reduce((s, r) => s + (r.dayPnl || 0), 0);
  const dayPct = marketValue - dayPnl > 0 ? (dayPnl / (marketValue - dayPnl)) * 100 : null;
  const groups = new Map();
  for (const row of rows) {
    const key = row.market || '未分類';
    const cur = groups.get(key) || { key, marketValue: 0 };
    cur.marketValue += row.marketValue || 0;
    groups.set(key, cur);
  }
  const allocation = [...groups.values()]
    .map((g) => ({
      key: g.key,
      marketValue: g.marketValue,
      weight: marketValue > 0 ? (g.marketValue / marketValue) * 100 : 0,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);
  return {
    count: rows.length,
    cost,
    marketValue,
    pnl,
    pnlPct,
    dayPnl,
    dayPct,
    allocation,
  };
}

async function getOwnedPortfolio(userId, portfolioId) {
  const r = await pool.query(
    'SELECT id, user_id, name, note, created_at, updated_at FROM user_portfolios WHERE id = $1 AND user_id = $2',
    [portfolioId, userId]
  );
  return r.rows[0] || null;
}

router.get('/quotes', async (req, res) => {
  try {
    const symbols = parseSymbolsParam(req.query.symbols);
    if (!symbols.length) {
      return res.json({ success: true, data: { asOfDate: null, quotes: [] } });
    }
    const data = await fetchQuotes(symbols);
    return res.json({ success: true, data });
  } catch (error) {
    console.error('portfolios quotes error:', error);
    return res.status(500).json({ success: false, message: '讀取報價失敗' });
  }
});

router.post('/frontier', async (req, res) => {
  try {
    const symbols = parseSymbolsParam(
      Array.isArray(req.body?.symbols) ? req.body.symbols.join(',') : req.body?.symbols
    );
    if (symbols.length < 2) {
      return res.status(400).json({ success: false, message: '請至少選擇 2 檔標的' });
    }
    if (symbols.length > 16) {
      return res.status(400).json({ success: false, message: '一次最多 16 檔，以免共變估計不穩' });
    }
    const lookback = [252, 504, 756].includes(Number(req.body?.lookback))
      ? Number(req.body.lookback)
      : 504;
    const rf = Number(req.body?.rf);
    const longOnly = req.body?.longOnly !== false && req.body?.allowShort !== true;

    const info = await pool.query(
      `SELECT symbol, COALESCE(name, short_name, symbol) AS name
       FROM tw_stock_symbols
       WHERE symbol = ANY($1::text[])`,
      [symbols]
    );
    const names = Object.fromEntries((info.rows || []).map((r) => [r.symbol, r.name]));

    const rows = await pool.query(
      `
      WITH latest AS (
        SELECT MAX(date) AS d FROM tw_stock_returns WHERE symbol = ANY($1::text[])
      )
      SELECT to_char(r.date, 'YYYY-MM-DD') AS date, r.symbol, r.daily_return::float8 AS ret
      FROM tw_stock_returns r, latest
      WHERE r.symbol = ANY($1::text[])
        AND r.daily_return IS NOT NULL
        AND r.date > latest.d - ($2::int * INTERVAL '1 day')
      ORDER BY r.date, r.symbol
      `,
      [symbols, Math.round(lookback * 1.7)]
    );

    const series = {};
    for (const row of rows.rows || []) {
      const sym = row.symbol;
      if (!series[sym]) series[sym] = [];
      series[sym].push({ date: row.date, ret: row.ret });
    }
    for (const sym of Object.keys(series)) {
      const dec = toDecimalReturns(series[sym].map((p) => p.ret));
      series[sym] = series[sym].map((p, i) => ({ date: p.date, ret: dec[i] }));
    }

    const missing = symbols.filter((s) => !series[s]?.length);
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `找不到報酬資料：${missing.join('、')}`,
      });
    }

    const aligned = alignReturnMatrix(series);
    if (aligned.dates.length > lookback) {
      aligned.dates = aligned.dates.slice(-lookback);
      aligned.matrix = aligned.matrix.map((row) => row.slice(-lookback));
    }

    const data = buildFrontier({
      symbols: aligned.symbols,
      names,
      matrix: aligned.matrix,
      rfAnnual: Number.isFinite(rf) ? rf : 0.015,
      longOnly,
    });
    data.startDate = aligned.dates[0] || null;
    data.endDate = aligned.dates[aligned.dates.length - 1] || null;
    return res.json({ success: true, data });
  } catch (error) {
    console.error('portfolios frontier error:', error);
    return res.status(error.code === 'INSUFFICIENT_HISTORY' || error.code === 'SINGULAR' ? 400 : 500).json({
      success: false,
      message: error.message || '效率前緣計算失敗',
    });
  }
});

router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 1) return res.json({ success: true, data: [] });
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const r = await pool.query(
      `
      SELECT symbol, COALESCE(name, short_name, symbol) AS name, COALESCE(market, '') AS market
      FROM tw_stock_symbols
      WHERE symbol ILIKE $1 OR name ILIKE $1 OR short_name ILIKE $1
      ORDER BY
        CASE WHEN symbol ILIKE $2 THEN 0 ELSE 1 END,
        symbol
      LIMIT 12
      `,
      [like, `${q.replace(/[%_]/g, '')}%`]
    );
    return res.json({ success: true, data: r.rows || [] });
  } catch (error) {
    console.error('portfolios search error:', error);
    return res.status(500).json({ success: false, message: '搜尋失敗' });
  }
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: '請先登入' });
    const r = await pool.query(
      `
      SELECT p.id, p.name, p.note, p.updated_at,
             COUNT(h.id)::int AS holding_count
      FROM user_portfolios p
      LEFT JOIN user_portfolio_holdings h ON h.portfolio_id = p.id
      WHERE p.user_id = $1
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.id DESC
      `,
      [userId]
    );
    return res.json({ success: true, data: r.rows || [] });
  } catch (error) {
    console.error('portfolios list error:', error);
    return res.status(500).json({ success: false, message: '讀取投資組合失敗' });
  }
});

router.post('/', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    if (!userId) return res.status(401).json({ success: false, message: '請先登入' });
    const name = String(req.body?.name || '').trim().slice(0, MAX_NAME) || '我的投資組合';
    const note = String(req.body?.note || '').trim().slice(0, 200);
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM user_portfolios WHERE user_id = $1', [userId]);
    if ((count.rows[0]?.n || 0) >= MAX_PORTFOLIOS) {
      return res.status(400).json({ success: false, message: `最多 ${MAX_PORTFOLIOS} 組投資組合` });
    }
    const ins = await pool.query(
      'INSERT INTO user_portfolios (user_id, name, note) VALUES ($1, $2, $3) RETURNING id, name, note, updated_at',
      [userId, name, note]
    );
    return res.json({ success: true, data: { ...ins.rows[0], holding_count: 0 } });
  } catch (error) {
    console.error('portfolios create error:', error);
    return res.status(500).json({ success: false, message: '建立失敗' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    if (!userId || !Number.isFinite(id)) return res.status(400).json({ success: false, message: '參數錯誤' });
    const portfolio = await getOwnedPortfolio(userId, id);
    if (!portfolio) return res.status(404).json({ success: false, message: '找不到投資組合' });
    const holds = await pool.query(
      'SELECT id, symbol, shares, avg_cost FROM user_portfolio_holdings WHERE portfolio_id = $1 ORDER BY symbol',
      [id]
    );
    const symbols = holds.rows.map((r) => r.symbol);
    const { asOfDate, quotes } = await fetchQuotes(symbols);
    const holdings = enrichHoldings(holds.rows, quotes);
    return res.json({
      success: true,
      data: {
        id: Number(portfolio.id),
        name: portfolio.name,
        note: portfolio.note,
        updatedAt: portfolio.updated_at,
        asOfDate,
        holdings,
        summary: summarize(holdings),
      },
    });
  } catch (error) {
    console.error('portfolios detail error:', error);
    return res.status(500).json({ success: false, message: '讀取持股失敗' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    if (!userId || !Number.isFinite(id)) return res.status(400).json({ success: false, message: '參數錯誤' });
    const name = String(req.body?.name || '').trim().slice(0, MAX_NAME);
    const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 200) : null;
    if (!name && note == null) return res.status(400).json({ success: false, message: '沒有可更新的欄位' });
    const r = await pool.query(
      `
      UPDATE user_portfolios
      SET name = COALESCE(NULLIF($3, ''), name),
          note = COALESCE($4, note),
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING id, name, note, updated_at
      `,
      [id, userId, name, note]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: '找不到投資組合' });
    return res.json({ success: true, data: r.rows[0] });
  } catch (error) {
    console.error('portfolios patch error:', error);
    return res.status(500).json({ success: false, message: '更新失敗' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    if (!userId || !Number.isFinite(id)) return res.status(400).json({ success: false, message: '參數錯誤' });
    const r = await pool.query('DELETE FROM user_portfolios WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    if (!r.rows[0]) return res.status(404).json({ success: false, message: '找不到投資組合' });
    return res.json({ success: true });
  } catch (error) {
    console.error('portfolios delete error:', error);
    return res.status(500).json({ success: false, message: '刪除失敗' });
  }
});

router.post('/:id/holdings', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    const symbol = normalizeSymbol(req.body?.symbol);
    const shares = toNum(req.body?.shares);
    const avgCost = toNum(req.body?.avgCost ?? req.body?.avg_cost);
    if (!userId || !Number.isFinite(id) || !symbol || !(shares > 0) || !(avgCost >= 0)) {
      return res.status(400).json({ success: false, message: '請填寫代號、股數與成本' });
    }
    const portfolio = await getOwnedPortfolio(userId, id);
    if (!portfolio) return res.status(404).json({ success: false, message: '找不到投資組合' });
    const count = await pool.query(
      'SELECT COUNT(*)::int AS n FROM user_portfolio_holdings WHERE portfolio_id = $1',
      [id]
    );
    const exists = await pool.query(
      'SELECT id FROM user_portfolio_holdings WHERE portfolio_id = $1 AND symbol = $2',
      [id, symbol]
    );
    if (!exists.rows[0] && (count.rows[0]?.n || 0) >= MAX_HOLDINGS) {
      return res.status(400).json({ success: false, message: `每組最多 ${MAX_HOLDINGS} 檔` });
    }
    await pool.query(
      `
      INSERT INTO user_portfolio_holdings (portfolio_id, symbol, shares, avg_cost)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (portfolio_id, symbol)
      DO UPDATE SET shares = EXCLUDED.shares, avg_cost = EXCLUDED.avg_cost, updated_at = NOW()
      `,
      [id, symbol, shares, avgCost]
    );
    await pool.query('UPDATE user_portfolios SET updated_at = NOW() WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (error) {
    console.error('portfolios add holding error:', error);
    return res.status(500).json({ success: false, message: '加入持股失敗' });
  }
});

router.patch('/:id/holdings/:holdingId', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    const holdingId = Number(req.params.holdingId);
    const shares = toNum(req.body?.shares);
    const avgCost = toNum(req.body?.avgCost ?? req.body?.avg_cost);
    if (!userId || !Number.isFinite(id) || !Number.isFinite(holdingId) || !(shares > 0) || !(avgCost >= 0)) {
      return res.status(400).json({ success: false, message: '參數錯誤' });
    }
    const portfolio = await getOwnedPortfolio(userId, id);
    if (!portfolio) return res.status(404).json({ success: false, message: '找不到投資組合' });
    const r = await pool.query(
      `
      UPDATE user_portfolio_holdings
      SET shares = $3, avg_cost = $4, updated_at = NOW()
      WHERE id = $1 AND portfolio_id = $2
      RETURNING id
      `,
      [holdingId, id, shares, avgCost]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, message: '找不到持股' });
    await pool.query('UPDATE user_portfolios SET updated_at = NOW() WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (error) {
    console.error('portfolios update holding error:', error);
    return res.status(500).json({ success: false, message: '更新持股失敗' });
  }
});

router.delete('/:id/holdings/:holdingId', async (req, res) => {
  try {
    await ensurePortfolioTables();
    const userId = userIdOf(req);
    const id = Number(req.params.id);
    const holdingId = Number(req.params.holdingId);
    if (!userId || !Number.isFinite(id) || !Number.isFinite(holdingId)) {
      return res.status(400).json({ success: false, message: '參數錯誤' });
    }
    const portfolio = await getOwnedPortfolio(userId, id);
    if (!portfolio) return res.status(404).json({ success: false, message: '找不到投資組合' });
    await pool.query('DELETE FROM user_portfolio_holdings WHERE id = $1 AND portfolio_id = $2', [holdingId, id]);
    await pool.query('UPDATE user_portfolios SET updated_at = NOW() WHERE id = $1', [id]);
    return res.json({ success: true });
  } catch (error) {
    console.error('portfolios delete holding error:', error);
    return res.status(500).json({ success: false, message: '刪除持股失敗' });
  }
});

export default router;
