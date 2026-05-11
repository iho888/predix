// Parameter sweep for Resolution Sniper — finds the smallest relaxation of the
// T-0009 constrained config that clears the harness `nTrades >= 30` floor while
// keeping maxDD <= 20% and Sharpe >= 0.5. Reuses the engine-replica logic from
// scripts/bench-resolution-sniper.cjs (kept in sync; see B-0002 for why we don't
// use the real engine here).
"use strict"
const postgres = require("postgres")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

const SIDE = "YES"
const INITIAL_CAPITAL = 1000
// Window override via --start / --end (YYYY-MM-DD). Default covers full data.
function parseArg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
const SIM_START = new Date(parseArg("--start", "2023-01-01") + "T00:00:00Z")
const SIM_END = new Date(parseArg("--end", "2026-05-09") + "T23:59:59Z")

const FIXED = {
  minLiquidityNum: 1000,
  minVolumeNum: 5000,
  takeProfitPct: 0.50,
  maxHoldingDays: null,
  maxOpenPositions: 10,
  // stopLossPct and positionSizePct vary in this sweep
}

// (stopLossPct, positionSizePct) sweep with slug filter. The minPrice sweep
// (2026-05-09) showed the entry band is locked at 0.85+ — lower entries collapse
// win rate. Strategy edge is structurally narrow at the high band. To raise ROI,
// we tighten SL (limit per-trade losses; 0.80 → ~0.15 means losers cost ~$15
// instead of ~$50) and increase position size (5% → 10-20%) to scale wins.
const SWEEP = []
for (const stopLossPct of [0.05, 0.10, 0.15, 0.20, 0.30, 0.50, 0.80]) {
  for (const positionSizePct of [5, 10, 15, 20]) {
    SWEEP.push({
      ...FIXED,
      minPrice: 0.85, maxPrice: 0.95, endWithinDays: 30,
      stopLossPct, positionSizePct,
    })
  }
}

const EXCLUDED_SLUG_PATTERNS = [
  "lol-%", "csgo-%", "cs2-%", "dota-%", "valorant-%",
  "%-game1", "%-game2", "%-game3", "%-game4", "%-game5",
  "%-game-handicap-%",
  "%top-fantasy-%",
  "%win-nfl-mvp%",
  "%reach-the-%semifinal%",
  "%reach-the-%final%",
]

function differenceInDays(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000)
}
function exitPriceForSide(side, winningOutcomeIndex) {
  const idx = Number(winningOutcomeIndex)
  if (side === "YES") return idx === 0 ? 1 : 0
  return idx === 1 ? 1 : 0
}

async function loadMarkets(params) {
  return await sql`
    SELECT slug, question, "endDate", "liquidityNum", "volumeNum",
           "winningOutcomeIndex"::INT AS "winningOutcomeIndex"
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" BETWEEN ${SIM_START.toISOString()} AND ${SIM_END.toISOString()}
      AND ("liquidityNum" IS NULL OR "liquidityNum" >= ${params.minLiquidityNum})
      AND ("volumeNum" IS NULL OR "volumeNum" >= ${params.minVolumeNum})
      AND NOT (slug LIKE ANY(${EXCLUDED_SLUG_PATTERNS}))
    ORDER BY "endDate" ASC`
}
async function loadCandles(slug) {
  return await sql`
    SELECT "timestamp", "yesPrice"
    FROM "PolymarketPriceCandle"
    WHERE "marketSlug" = ${slug}
    ORDER BY "timestamp" ASC`
}

function evaluateMarket(market, candles, params) {
  if (candles.length === 0) return null
  const endMs = new Date(market.endDate).getTime()
  let entry = null
  for (const c of candles) {
    const p = SIDE === "YES" ? Number(c.yesPrice) : 1 - Number(c.yesPrice)
    if (!(p >= params.minPrice && p <= params.maxPrice)) continue
    if (params.endWithinDays != null) {
      const nowMs = new Date(c.timestamp).getTime()
      if (endMs < nowMs) continue
      if (endMs > nowMs + params.endWithinDays * 86400000) continue
    }
    entry = { time: c.timestamp, price: p }
    break
  }
  if (!entry) return null

  const tpAt = entry.price * (1 + params.takeProfitPct)
  const slAt = entry.price * (1 - params.stopLossPct)
  let exit = null
  for (const c of candles) {
    if (c.timestamp <= entry.time) continue
    const p = SIDE === "YES" ? Number(c.yesPrice) : 1 - Number(c.yesPrice)
    if (p >= tpAt) { exit = { time: c.timestamp, price: p, reason: "tp" }; break }
    if (p <= slAt) { exit = { time: c.timestamp, price: p, reason: "sl" }; break }
    if (params.maxHoldingDays != null) {
      const days = differenceInDays(new Date(c.timestamp), new Date(entry.time))
      if (days >= params.maxHoldingDays) { exit = { time: c.timestamp, price: p, reason: "maxhold" }; break }
    }
  }
  if (!exit) {
    const exitPrice = exitPriceForSide(SIDE, market.winningOutcomeIndex)
    exit = { time: market.endDate, price: exitPrice, reason: "resolution" }
  }
  return {
    slug: market.slug,
    entryTime: entry.time,
    entryPrice: entry.price,
    exitTime: exit.time,
    exitPrice: exit.price,
    pnlPctOfPosition: (exit.price - entry.price) / entry.price,
    won: exit.price > entry.price,
  }
}

function applyPortfolio(rawTrades, params) {
  const sorted = rawTrades.slice().sort((a, b) =>
    new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())
  const taken = []
  const open = []
  const positionSize = INITIAL_CAPITAL * (params.positionSizePct / 100)
  for (const t of sorted) {
    while (open.length > 0) {
      const earliest = open.reduce((a, b) =>
        new Date(a.exitTime) < new Date(b.exitTime) ? a : b)
      if (new Date(earliest.exitTime) <= new Date(t.entryTime)) {
        open.splice(open.indexOf(earliest), 1)
      } else break
    }
    if (open.length >= params.maxOpenPositions) continue
    open.push({ exitTime: t.exitTime })
    taken.push({ ...t, sizeUsd: positionSize, pnl: t.pnlPctOfPosition * positionSize })
  }
  return taken
}

function computeMetrics(trades) {
  const n = trades.length
  const winners = trades.filter((t) => t.won)
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
  const finalCapital = INITIAL_CAPITAL + totalPnL

  const events = []
  for (const t of trades) {
    events.push({ t: new Date(t.entryTime).getTime(), type: "entry", trade: t })
    events.push({ t: new Date(t.exitTime).getTime(), type: "exit", trade: t })
  }
  events.sort((a, b) => a.t - b.t)
  let equity = INITIAL_CAPITAL
  const curve = [{ t: events[0]?.t ?? 0, equity }]
  for (const e of events) {
    if (e.type === "exit") equity += e.trade.pnl
    curve.push({ t: e.t, equity })
  }

  let peak = INITIAL_CAPITAL, maxDD = 0
  for (const { equity } of curve) {
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDD) maxDD = dd
  }

  const byDay = new Map()
  for (const { t, equity } of curve) {
    const day = new Date(t).toISOString().slice(0, 10)
    byDay.set(day, equity)
  }
  const days = Array.from(byDay.keys()).sort()
  const dailyEquity = days.map((d) => byDay.get(d))
  const dailyReturns = []
  for (let i = 1; i < dailyEquity.length; i++) {
    const prev = dailyEquity[i - 1]
    if (prev <= 0) continue
    dailyReturns.push((dailyEquity[i] - prev) / prev)
  }
  const avgRet = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1)
  const stdRet = Math.sqrt(
    dailyReturns.reduce((s, r) => s + Math.pow(r - avgRet, 2), 0) / (dailyReturns.length || 1)
  )
  const sharpe = stdRet > 0 ? (avgRet / stdRet) * Math.sqrt(252) : 0

  return {
    nTrades: n,
    winRate: n === 0 ? 0 : winners.length / n,
    roiPct: ((finalCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100,
    maxDDPct: peak > 0 ? (maxDD / peak) * 100 : 0,
    sharpe,
  }
}

;(async () => {
  console.log(`Sweep window: ${SIM_START.toISOString().slice(0, 10)} → ${SIM_END.toISOString().slice(0, 10)}`)
  console.log(`Fixed: maxPrice=0.95, liq>=${FIXED.minLiquidityNum}, vol>=${FIXED.minVolumeNum}, position=${FIXED.positionSizePct}%, max ${FIXED.maxOpenPositions} open`)
  console.log()

  // Cache per minLiquidityNum/minVolumeNum (the only universe-affecting params here)
  const universeKey = `${FIXED.minLiquidityNum}|${FIXED.minVolumeNum}`
  const markets = await loadMarkets(FIXED)
  console.log(`Eligible universe (liq/vol filter only): ${markets.length} markets`)

  // Pre-load candles once per market (sweep only changes entry filters, not the candle set)
  const candlesBySlug = new Map()
  let loaded = 0
  for (const m of markets) {
    candlesBySlug.set(m.slug, await loadCandles(m.slug))
    loaded++
    if (loaded % 100 === 0) console.log(`  loaded candles ${loaded}/${markets.length}`)
  }
  console.log(`Loaded candles for ${loaded} markets\n`)

  const rows = []
  for (const params of SWEEP) {
    const raw = []
    for (const m of markets) {
      const t = evaluateMarket(m, candlesBySlug.get(m.slug), params)
      if (t) raw.push(t)
    }
    const taken = applyPortfolio(raw, params)
    const metrics = computeMetrics(taken)
    rows.push({
      stopLoss: params.stopLossPct,
      posSize: params.positionSizePct,
      ...metrics,
      passes: metrics.nTrades >= 30 && metrics.maxDDPct <= 20 && metrics.sharpe >= 0.5 && metrics.roiPct > 0 ? "✓" : "",
    })
  }

  console.log("=== Sweep results ===")
  console.table(rows.map((r) => ({
    stopLoss: r.stopLoss,
    "pos%": r.posSize,
    nTrades: r.nTrades,
    winRate: (r.winRate * 100).toFixed(1) + "%",
    roiPct: r.roiPct.toFixed(2),
    annROI: ((Math.pow(1 + r.roiPct/100, 365/1224) - 1) * 100).toFixed(2),
    maxDDPct: r.maxDDPct.toFixed(2),
    sharpe: r.sharpe.toFixed(2),
    passes: r.passes,
  })))

  await sql.end()
})().catch((e) => { console.error("FAIL", e.message, e.stack); process.exit(1) })
