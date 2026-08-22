const TRADING_DAYS = 252;
const RIDGE = 1e-8;

export function toDecimalReturns(values) {
  const xs = (values || []).map(Number).filter(Number.isFinite);
  if (!xs.length) return xs;
  const meanAbs = xs.reduce((s, v) => s + Math.abs(v), 0) / xs.length;
  return meanAbs > 0.2 ? xs.map((v) => v / 100) : xs;
}

export function sampleMean(xs) {
  const n = xs.length;
  if (!n) return 0;
  return xs.reduce((s, v) => s + v, 0) / n;
}

export function alignReturnMatrix(seriesBySymbol) {
  const symbols = Object.keys(seriesBySymbol);
  const dateSets = symbols.map((sym) => new Set((seriesBySymbol[sym] || []).map((p) => p.date)));
  const common = [...dateSets[0] || []].filter((d) => dateSets.every((set) => set.has(d))).sort();
  const maps = Object.fromEntries(symbols.map((sym) => [
    sym,
    new Map((seriesBySymbol[sym] || []).map((p) => [p.date, p.ret])),
  ]));
  const matrix = symbols.map((sym) => common.map((d) => maps[sym].get(d)));
  return { symbols, dates: common, matrix };
}

export function covariance(matrix) {
  const n = matrix.length;
  const t = n ? matrix[0].length : 0;
  const mu = matrix.map((row) => sampleMean(row));
  const cov = Array.from({ length: n }, () => Array(n).fill(0));
  if (t < 3) return { mu, cov };
  const denom = t - 1;
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let s = 0;
      for (let k = 0; k < t; k += 1) s += (matrix[i][k] - mu[i]) * (matrix[j][k] - mu[j]);
      const v = s / denom;
      cov[i][j] = v;
      cov[j][i] = v;
    }
  }
  return { mu, cov };
}

function clone(m) {
  return m.map((row) => row.slice());
}

export function invertMatrix(input) {
  const n = input.length;
  const a = clone(input);
  for (let i = 0; i < n; i += 1) a[i][i] += RIDGE;
  const inv = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
  for (let i = 0; i < n; i += 1) {
    let max = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(a[r][i]) > Math.abs(a[max][i])) max = r;
    }
    if (Math.abs(a[max][i]) < 1e-12) return null;
    if (max !== i) {
      [a[i], a[max]] = [a[max], a[i]];
      [inv[i], inv[max]] = [inv[max], inv[i]];
    }
    const pivot = a[i][i];
    for (let j = 0; j < n; j += 1) {
      a[i][j] /= pivot;
      inv[i][j] /= pivot;
    }
    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const f = a[r][i];
      for (let j = 0; j < n; j += 1) {
        a[r][j] -= f * a[i][j];
        inv[r][j] -= f * inv[i][j];
      }
    }
  }
  return inv;
}

function matVec(m, v) {
  return m.map((row) => row.reduce((s, x, i) => s + x * v[i], 0));
}

function dot(a, b) {
  return a.reduce((s, x, i) => s + x * b[i], 0);
}

function scale(v, k) {
  return v.map((x) => x * k);
}

function add(a, b) {
  return a.map((x, i) => x + b[i]);
}

function ones(n) {
  return Array(n).fill(1);
}

function normalize(w, longOnly) {
  let next = longOnly ? w.map((x) => Math.max(0, x)) : w.slice();
  const s = next.reduce((a, b) => a + b, 0);
  if (Math.abs(s) < 1e-12) return Array(w.length).fill(1 / w.length);
  return next.map((x) => x / s);
}

function portfolioStats(w, mu, cov) {
  const ret = dot(w, mu);
  const var_ = Math.max(0, dot(w, matVec(cov, w)));
  return { ret, vol: Math.sqrt(var_) };
}

function unconstrainedTarget(mu, inv, target) {
  const n = mu.length;
  const one = ones(n);
  const inv1 = matVec(inv, one);
  const invMu = matVec(inv, mu);
  const A = dot(one, inv1);
  const B = dot(one, invMu);
  const C = dot(mu, invMu);
  const delta = A * C - B * B;
  if (Math.abs(delta) < 1e-14) return normalize(inv1, false);
  const w = add(
    scale(inv1, (C - B * target) / delta),
    scale(invMu, (A * target - B) / delta),
  );
  return w;
}

function projectOptimize(mu, cov, { mode, target, rf, longOnly }) {
  const n = mu.length;
  let w = Array(n).fill(1 / n);
  let lr = 0.15;
  for (let iter = 0; iter < 900; iter += 1) {
    const Sw = matVec(cov, w);
    const { ret, vol } = portfolioStats(w, mu, cov);
    let g;
    if (mode === 'gmv') g = Sw;
    else if (mode === 'target') {
      g = add(Sw, scale(mu, 8 * (ret - target)));
    } else {
      const excess = ret - rf;
      const safeVol = Math.max(vol, 1e-8);
      g = scale(add(scale(mu, -safeVol), scale(Sw, excess / safeVol)), 1);
    }
    w = w.map((wi, i) => wi - lr * g[i]);
    w = normalize(w, longOnly);
    if (iter % 180 === 179) lr *= 0.7;
  }
  return normalize(w, longOnly);
}

export function buildFrontier({ symbols, names = {}, matrix, rfAnnual = 0.015, longOnly = true, points = 28 }) {
  const { mu, cov } = covariance(matrix);
  const n = symbols.length;
  if (n < 2 || (matrix[0] || []).length < 40) {
    const err = new Error('有效共同交易日不足，請減少標的或拉長回顧期');
    err.code = 'INSUFFICIENT_HISTORY';
    throw err;
  }
  const inv = invertMatrix(cov);
  if (!inv) {
    const err = new Error('共變異數矩陣無法反轉，請調整標的組合');
    err.code = 'SINGULAR';
    throw err;
  }

  const muAnn = mu.map((x) => x * TRADING_DAYS);
  const covAnn = cov.map((row) => row.map((v) => v * TRADING_DAYS));
  const rf = Number.isFinite(rfAnnual) ? rfAnnual : 0.015;

  const gmv = longOnly
    ? projectOptimize(muAnn, covAnn, { mode: 'gmv', longOnly: true })
    : normalize(matVec(inv, ones(n)), false);
  const tangency = longOnly
    ? projectOptimize(muAnn, covAnn, { mode: 'sharpe', rf, longOnly: true })
    : (() => {
      const excess = muAnn.map((x) => x - rf);
      return normalize(matVec(invertMatrix(covAnn) || inv, excess), false);
    })();

  const assetRets = muAnn;
  const lo = Math.min(...assetRets);
  const hi = Math.max(...assetRets);
  const gmvStats = portfolioStats(gmv, muAnn, covAnn);
  const start = longOnly ? gmvStats.ret : lo;
  const end = hi;
  const curve = [];
  for (let i = 0; i < points; i += 1) {
    const t = points === 1 ? 0 : i / (points - 1);
    const target = start + (end - start) * t;
    const w = longOnly
      ? projectOptimize(muAnn, covAnn, { mode: 'target', target, longOnly: true })
      : unconstrainedTarget(muAnn, invertMatrix(covAnn) || inv, target);
    const stats = portfolioStats(w, muAnn, covAnn);
    curve.push({
      ret: stats.ret,
      vol: stats.vol,
      sharpe: stats.vol > 0 ? (stats.ret - rf) / stats.vol : 0,
      weights: Object.fromEntries(symbols.map((sym, idx) => [sym, w[idx]])),
    });
  }

  const assets = symbols.map((sym, i) => {
    const vol = Math.sqrt(Math.max(0, covAnn[i][i]));
    return {
      symbol: sym,
      name: names[sym] || sym,
      ret: muAnn[i],
      vol,
      sharpe: vol > 0 ? (muAnn[i] - rf) / vol : 0,
    };
  });

  const pack = (w) => {
    const stats = portfolioStats(w, muAnn, covAnn);
    return {
      ret: stats.ret,
      vol: stats.vol,
      sharpe: stats.vol > 0 ? (stats.ret - rf) / stats.vol : 0,
      weights: Object.fromEntries(symbols.map((sym, idx) => [sym, w[idx]])),
    };
  };

  return {
    tradingDays: TRADING_DAYS,
    observations: matrix[0].length,
    rf,
    longOnly,
    assets,
    gmv: pack(gmv),
    tangency: pack(tangency),
    frontier: curve,
  };
}
