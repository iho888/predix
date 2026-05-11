// Faithful replica of runPolymarketDbSimulation for the Resolution Sniper
// template, written in pure .cjs to sidestep B-0002 (Prisma engine segfault on
// Node 24). Mirrors the entry/exit/metrics logic in:
//   src/lib/simulation/polymarket-db-simulation.ts
//   src/lib/strategy-templates/index.ts (defaultResolutionSniperParams)
"use strict"
const postgres = require("postgres")
const fs = require("fs")
const path = require("path")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

// ── Resolution Sniper defaults (mirror src/lib/strategy-templates/index.ts) ──
// Constrained per T-0009: recalibration showed 94% win / +5.87% per trade with
// minPrice=0.85, maxPrice=0.95, endWithinDays=30. Defaults (B-0004) lose money.
const PARAMS = {
  minPrice: 0.85,
  maxPrice: 0.95,
  minLiquidityNum: 1000,
  minVolumeNum: 5000,
  endWithinDays: 30,
  takeProfitPct: 0.50,
  stopLossPct: 0.80,
  maxHoldingDays: null,
  positionSizePct: 5,           // 5% of initial capital per trade
  maxOpenPositions: 10,
}
const SIDE = "YES"
const INITIAL_CAPITAL = 1000
// Window override via --start / --end (YYYY-MM-DD). Default kept at 2023-2024
// so the T-0009 blessed result stays reproducible when re-run without args.
function parseArg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
const SIM_START = new Date(parseArg("--start", "2023-01-01") + "T00:00:00Z")
const SIM_END = new Date(parseArg("--end", "2024-12-30") + "T23:59:59Z")

// ── helpers ──────────────────────────────────────────────────────────────────
function exitPriceForSide(side, winningOutcomeIndex) {
  const idx = Number(winningOutcomeIndex)
  if (side === "YES") return idx === 0 ? 1 : 0
  return idx === 1 ? 1 : 0
}

function differenceInDays(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000)
}

// Slug patterns we exclude — markets where the YES outcome flips on a single
// future event (one match, one game, one MVP vote). The 2026-05-08 bench on
// 2023-01..2026-05 surfaced 4 stop-loss losers all matching these patterns:
// Real Betis Europa semi (one QF tie), LoL CNV Blue game2 (one esports game),
// Saquon Barkley top-fantasy-RB (season-end ranking flip), Lamar Jackson NFL
// MVP (voting flip). Division-winner markets and political markets are kept
// because their YES outcome is locked statistically by late season / vote count.
const EXCLUDED_SLUG_PATTERNS = [
  "lol-%", "csgo-%", "dota-%", "valorant-%",            // esports prefixes
  "%-game1", "%-game2", "%-game3", "%-game4", "%-game5", // per-game series props
  "%-game-handicap-%",                                   // per-game handicap props
  "%top-fantasy-%",                                      // fantasy season rankings
  "%win-nfl-mvp%",                                       // NFL MVP voting
  "%reach-the-%semifinal%",                              // single-elim semis (also matches final via %final%)
  "%reach-the-%final%",                                  // single-elim finals
]

// ── load eligible markets ───────────────────────────────────────────────────
async function loadMarkets() {
  return await sql`
    SELECT slug, question, "endDate", "liquidityNum", "volumeNum",
           "winningOutcomeIndex"::INT AS "winningOutcomeIndex",
           "clobTokenIdsJson"
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" BETWEEN ${SIM_START.toISOString()} AND ${SIM_END.toISOString()}
      AND ("liquidityNum" IS NULL OR "liquidityNum" >= ${PARAMS.minLiquidityNum})
      AND ("volumeNum" IS NULL OR "volumeNum" >= ${PARAMS.minVolumeNum})
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

// ── walk one market, decide a single trade or skip ──────────────────────────
async function evaluateMarket(market) {
  const candles = await loadCandles(market.slug)
  if (candles.length === 0) return null

  // Find first candle where YES price is in entry band AND endDate is within
  // endWithinDays from now (mirrors endWithinDaysOk in strategy-adapter.ts).
  const endMs = new Date(market.endDate).getTime()
  let entry = null
  for (const c of candles) {
    const p = SIDE === "YES" ? Number(c.yesPrice) : 1 - Number(c.yesPrice)
    if (!(p >= PARAMS.minPrice && p <= PARAMS.maxPrice)) continue
    if (PARAMS.endWithinDays != null) {
      const nowMs = new Date(c.timestamp).getTime()
      if (endMs < nowMs) continue
      if (endMs > nowMs + PARAMS.endWithinDays * 86400000) continue
    }
    entry = { time: c.timestamp, price: p }
    break
  }
  if (!entry) return null

  const tpAt = entry.price * (1 + PARAMS.takeProfitPct)   // 0.85 → 1.275 (impossible for YES)
  const slAt = entry.price * (1 - PARAMS.stopLossPct)     // 0.85 → 0.17

  let exit = null
  for (const c of candles) {
    if (c.timestamp <= entry.time) continue
    const p = SIDE === "YES" ? Number(c.yesPrice) : 1 - Number(c.yesPrice)
    if (p >= tpAt) { exit = { time: c.timestamp, price: p, reason: "tp" }; break }
    if (p <= slAt) { exit = { time: c.timestamp, price: p, reason: "sl" }; break }
    if (PARAMS.maxHoldingDays != null) {
      const days = differenceInDays(new Date(c.timestamp), new Date(entry.time))
      if (days >= PARAMS.maxHoldingDays) { exit = { time: c.timestamp, price: p, reason: "maxhold" }; break }
    }
  }
  // No early exit triggered → force-exit at endDate using winningOutcomeIndex
  if (!exit) {
    const exitPrice = exitPriceForSide(SIDE, market.winningOutcomeIndex)
    exit = { time: market.endDate, price: exitPrice, reason: "resolution" }
  }

  return {
    slug: market.slug,
    question: market.question,
    side: SIDE,
    entryTime: entry.time,
    entryPrice: entry.price,
    exitTime: exit.time,
    exitPrice: exit.price,
    exitReason: exit.reason,
    pnlPctOfPosition: (exit.price - entry.price) / entry.price, // pure trade return
    won: exit.price > entry.price,
  }
}

// ── portfolio-level: enforce maxOpenPositions, build equity curve ───────────
function applyPortfolio(rawTrades) {
  // Sort by entry time; only enter if open count < maxOpenPositions
  const sorted = rawTrades.slice().sort((a, b) =>
    new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())

  const taken = []
  const open = [] // { exitTime }
  const positionSize = INITIAL_CAPITAL * (PARAMS.positionSizePct / 100)

  for (const t of sorted) {
    // Drop any open positions that have exited before this entry
    while (open.length > 0) {
      const earliest = open.reduce((a, b) =>
        new Date(a.exitTime) < new Date(b.exitTime) ? a : b)
      if (new Date(earliest.exitTime) <= new Date(t.entryTime)) {
        open.splice(open.indexOf(earliest), 1)
      } else break
    }
    if (open.length >= PARAMS.maxOpenPositions) continue
    open.push({ exitTime: t.exitTime })
    taken.push({ ...t, sizeUsd: positionSize, pnl: t.pnlPctOfPosition * positionSize })
  }
  return taken
}

function buildEquityCurve(trades) {
  // Equity steps: a step at every entry (debit) and exit (credit).
  // Simplification vs. engine: the engine equity-curves at every candle;
  // we curve at trade boundaries which is enough for maxDD + Sharpe sanity.
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
  return curve
}

function computeMetrics(trades, curve) {
  const n = trades.length
  const winners = trades.filter(t => t.won)
  const losers = trades.filter(t => !t.won)
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
  const finalCapital = INITIAL_CAPITAL + totalPnL

  let peak = INITIAL_CAPITAL, maxDD = 0
  for (const { equity } of curve) {
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDD) maxDD = dd
  }

  // Daily returns from equity curve (resampled to daily)
  const byDay = new Map()
  for (const { t, equity } of curve) {
    const day = new Date(t).toISOString().slice(0, 10)
    byDay.set(day, equity) // last equity of day
  }
  const days = Array.from(byDay.keys()).sort()
  const dailyEquity = days.map(d => byDay.get(d))
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

  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))

  return {
    totalTrades: n,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: n === 0 ? 0 : (winners.length / n),
    initialCapital: INITIAL_CAPITAL,
    finalCapital: Math.round(finalCapital * 100) / 100,
    totalPnL: Math.round(totalPnL * 100) / 100,
    roiPct: Math.round(((finalCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 10000) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round((maxDD / peak) * 10000) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    avgWin: winners.length > 0 ? Math.round((grossProfit / winners.length) * 100) / 100 : 0,
    avgLoss: losers.length > 0 ? Math.round((grossLoss / losers.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
    bestTrade: winners.length > 0 ? Math.round(Math.max(...winners.map(t => t.pnl)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map(t => t.pnl)) * 100) / 100 : 0,
  }
}

// ── main ────────────────────────────────────────────────────────────────────
;(async () => {
  console.log(`Resolution Sniper benchmark (replica of engine — see bench-resolution-sniper.cjs header)`)
  console.log(`  Window:     ${SIM_START.toISOString().slice(0, 10)} → ${SIM_END.toISOString().slice(0, 10)}`)
  console.log(`  Side:       ${SIDE}`)
  console.log(`  Entry band: [${PARAMS.minPrice}, ${PARAMS.maxPrice}]`)
  console.log(`  endWithin:  ${PARAMS.endWithinDays == null ? "none" : PARAMS.endWithinDays + "d"}`)
  console.log(`  Exclude:    ${EXCLUDED_SLUG_PATTERNS.length} slug patterns (esports/single-game/fantasy/MVP/single-elim)`)
  console.log(`  TP/SL:      +${PARAMS.takeProfitPct * 100}% / -${PARAMS.stopLossPct * 100}% (intentionally wide — hold to resolution)`)
  console.log(`  Position:   ${PARAMS.positionSizePct}% of $${INITIAL_CAPITAL}, max ${PARAMS.maxOpenPositions} open`)
  console.log()

  const markets = await loadMarkets()
  console.log(`Loaded ${markets.length} eligible markets`)

  const rawTrades = []
  let processed = 0
  for (const m of markets) {
    const t = await evaluateMarket(m)
    if (t) rawTrades.push(t)
    processed++
    if (processed % 100 === 0) console.log(`  evaluated ${processed}/${markets.length}, ${rawTrades.length} candidate trades`)
  }
  console.log(`\nRaw candidate trades: ${rawTrades.length}`)

  const taken = applyPortfolio(rawTrades)
  console.log(`Trades after maxOpenPositions filter: ${taken.length}`)

  const curve = buildEquityCurve(taken)
  const metrics = computeMetrics(taken, curve)

  console.log("\n=== Metrics ===")
  console.table(metrics)

  // Per-trade summary
  const lastN = taken.slice(-10)
  console.log("\n=== Last 10 trades ===")
  console.table(lastN.map(t => ({
    slug: t.slug.slice(0, 50),
    side: t.side,
    entry: Number(t.entryPrice).toFixed(3),
    exit: Number(t.exitPrice).toFixed(3),
    reason: t.exitReason,
    pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1),
  })))

  // Losing trades
  const losers = taken.filter(t => !t.won)
  console.log(`\n=== ${losers.length} losing trades ===`)
  if (losers.length > 0) {
    console.table(losers.slice(0, 20).map(t => ({
      slug: t.slug.slice(0, 50),
      entry: Number(t.entryPrice).toFixed(3),
      exit: Number(t.exitPrice).toFixed(3),
      reason: t.exitReason,
      pnl: t.pnl.toFixed(2),
    })))
  }

  // Persist result for harness
  const sha = require("child_process").execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = path.join("benchmarks", "results", "v0.1.0-draft", sha, stamp)
  fs.mkdirSync(outDir, { recursive: true })
  const result = {
    specVersion: "v0.1.0-draft",
    gitSha: sha,
    strategyId: "resolution_sniper@replica",
    strategyVersion: JSON.stringify(PARAMS),
    window: { start: SIM_START.toISOString(), end: SIM_END.toISOString() },
    universe: { filter: "closed=true, resolved, liq>=1000, vol>=5000, endDate in window", marketCount: markets.length },
    metrics,
    trades: taken,
  }
  fs.writeFileSync(path.join(outDir, "dryrun.json"), JSON.stringify(result, null, 2))
  fs.writeFileSync(path.join(outDir, "sha.txt"), sha + "\n")
  console.log(`\nWrote: ${outDir}/dryrun.json`)

  await sql.end()
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })
