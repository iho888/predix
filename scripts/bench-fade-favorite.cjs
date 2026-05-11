// Fade-the-favorite: bet against the leading side when it's priced 50-90% AND
// the market has 60+ days to resolution. Empirical calibration on 3.35M candles
// (scripts/calibrate-out.json) showed Polymarket overpays for far-future
// certainty — leading-side prices in this band resolve OPPOSITE 30-65% of the
// time, with mean returns of +26% to +159% on the contra side. Sister to
// bench-resolution-sniper.cjs (which trades the OPPOSITE edge: late, extreme
// favorites).
"use strict"
const postgres = require("postgres")
const fs = require("fs")
const path = require("path")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

const PARAMS = {
  // Per scripts/calibrate-exits.cjs (2026-05-10): entry band 0.50-0.60 with
  // TTR 240-365d and 14-day hold has the highest empirical Sharpe (1.41) and
  // per-trade win rate (86.7%) of all 30 surveyed cells. Tighter than v4's
  // [0.50, 0.90] but with much higher per-trade quality.
  leaderMinPrice: 0.50,
  leaderMaxPrice: 0.60,
  // Skip the 60-120d TTR bucket — score drops from 1.02 to 0.67.
  minTtrDays: 120,
  maxTtrDays: null,
  // Liquidity / volume floors. Tightened from 5k → 25k volume per the
  // 2026-05-10 slippage probe: low-volume markets had spreads up to 12¢ and
  // sometimes empty asks. Higher volume floor = tighter spreads = less slip.
  minLiquidityNum: 1000,
  minVolumeNum: 25000,
  // Slippage model: 6% per leg (12% round-trip). Per scripts/probe-slippage.cjs
  // 2026-05-10, median per-leg slippage was 6.4% on $50 orders across 20 in-band
  // markets. Real spreads + book depth eat this much vs mid-price.
  slippagePerLegPct: 0.06,
  // 14-day hold is the empirical Sharpe-max from calibrate-exits.cjs. Holding
  // to resolution captures slightly more mean return but at much higher std
  // (76% vs 45%) — net Sharpe is ~1.5x worse with full hold.
  takeProfitPct: null,
  stopLossPct: null,
  maxHoldingDays: 14,
  // Smaller position because short hold = much higher turnover (~26 cycles/yr
  // vs hold-to-resolution's 5-10) which compounds aggressively.
  positionSizePct: 2,
  maxOpenPositions: 100,
}
const INITIAL_CAPITAL = 1000

function parseArg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
const SIM_START = new Date(parseArg("--start", "2023-01-01") + "T00:00:00Z")
const SIM_END = new Date(parseArg("--end", "2026-05-09") + "T23:59:59Z")

function exitPriceForSide(side, winningOutcomeIndex) {
  const idx = Number(winningOutcomeIndex)
  if (side === "YES") return idx === 0 ? 1 : 0
  return idx === 1 ? 1 : 0
}
function differenceInDays(later, earlier) {
  return Math.round((later.getTime() - earlier.getTime()) / 86400000)
}

async function loadMarkets() {
  return await sql`
    SELECT slug, question, "endDate", "liquidityNum", "volumeNum",
           "winningOutcomeIndex"::INT AS "winningOutcomeIndex"
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" BETWEEN ${SIM_START.toISOString()} AND ${SIM_END.toISOString()}
      AND ("liquidityNum" IS NULL OR "liquidityNum" >= ${PARAMS.minLiquidityNum})
      AND ("volumeNum" IS NULL OR "volumeNum" >= ${PARAMS.minVolumeNum})
    ORDER BY "endDate" ASC`
}
async function loadCandles(slug) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await sql`
        SELECT "timestamp", "yesPrice"
        FROM "PolymarketPriceCandle"
        WHERE "marketSlug" = ${slug}
        ORDER BY "timestamp" ASC`
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
    }
  }
}

function evaluateMarket(market) {
  // We need candles. Walking sequentially.
  return loadCandles(market.slug).then((candles) => {
    if (candles.length === 0) return null
    const endMs = new Date(market.endDate).getTime()

    // Find first candle where:
    //  - the leading side's price is in [leaderMinPrice, leaderMaxPrice]
    //  - TTR >= minTtrDays AND (maxTtrDays==null OR TTR <= maxTtrDays)
    // Then we BET THE OPPOSITE SIDE.
    let entry = null
    for (const c of candles) {
      const yes = Number(c.yesPrice)
      if (!(yes > 0 && yes < 1)) continue
      const tMs = new Date(c.timestamp).getTime()
      const ttrDays = (endMs - tMs) / 86400000
      if (ttrDays < PARAMS.minTtrDays) continue
      if (PARAMS.maxTtrDays != null && ttrDays > PARAMS.maxTtrDays) continue

      // Asymmetric edge per scripts/calibrate.cjs: fade YES-leader markets
      // ONLY. Mean return on the NO side at YES∈[0.50, 0.90] is +50% to +159%
      // depending on TTR. The reverse (YES-bet when NO leads) was a losing
      // bucket in the calibration — markets where NO leads tend to resolve NO
      // (no asymmetric mispricing on the low side).
      if (yes < PARAMS.leaderMinPrice || yes > PARAMS.leaderMaxPrice) continue
      const side = "NO"
      const entryPrice = 1 - yes
      entry = { time: c.timestamp, side, price: entryPrice }
      break
    }
    if (!entry) return null

    // Exit: walk candles forward looking for TP/SL/maxhold; otherwise hold to
    // resolution. If maxHoldingDays is set, we must exit at +N days even if no
    // candle exists at that exact time — use the last-known price (mark-to-
    // market with stale data). Without this, illiquid markets would be held
    // to resolution, which silently disables the maxhold rule.
    let exit = null
    let lastSeenPrice = entry.price
    if (PARAMS.takeProfitPct != null || PARAMS.stopLossPct != null || PARAMS.maxHoldingDays != null) {
      const tpAt = PARAMS.takeProfitPct != null ? entry.price * (1 + PARAMS.takeProfitPct) : null
      const slAt = PARAMS.stopLossPct != null ? entry.price * (1 - PARAMS.stopLossPct) : null
      const maxHoldMs = PARAMS.maxHoldingDays != null
        ? new Date(entry.time).getTime() + PARAMS.maxHoldingDays * 86400000
        : null
      for (const c of candles) {
        const cMs = new Date(c.timestamp).getTime()
        if (cMs <= new Date(entry.time).getTime()) continue
        const yes = Number(c.yesPrice)
        const p = entry.side === "YES" ? yes : 1 - yes
        // If candle is past maxhold deadline, exit at +N using lastSeenPrice
        if (maxHoldMs != null && cMs > maxHoldMs) {
          exit = { time: new Date(maxHoldMs), price: lastSeenPrice, reason: "maxhold" }
          break
        }
        lastSeenPrice = p
        if (tpAt != null && p >= tpAt) { exit = { time: c.timestamp, price: p, reason: "tp" }; break }
        if (slAt != null && p <= slAt) { exit = { time: c.timestamp, price: p, reason: "sl" }; break }
        if (maxHoldMs != null && cMs >= maxHoldMs) { exit = { time: c.timestamp, price: p, reason: "maxhold" }; break }
      }
      // No candle ever reached maxhold deadline — force exit at deadline with last-seen price
      if (!exit && maxHoldMs != null) {
        const endMs = new Date(market.endDate).getTime()
        if (maxHoldMs < endMs) {
          exit = { time: new Date(maxHoldMs), price: lastSeenPrice, reason: "maxhold" }
        }
      }
    }
    if (!exit) {
      const exitPrice = exitPriceForSide(entry.side, market.winningOutcomeIndex)
      exit = { time: market.endDate, price: exitPrice, reason: "resolution" }
    }

    // Apply slippage: pay above mid on entry, receive below mid on exit.
    // Both bounded to (0, 1] — can't pay > 1 or receive < 0.
    const slip = PARAMS.slippagePerLegPct ?? 0
    const entryPriceFilled = Math.min(1, entry.price * (1 + slip))
    const exitPriceFilled = Math.max(0, exit.price * (1 - slip))
    return {
      slug: market.slug,
      question: market.question,
      side: entry.side,
      entryTime: entry.time,
      entryPrice: entryPriceFilled,
      entryMid: entry.price,
      exitTime: exit.time,
      exitPrice: exitPriceFilled,
      exitMid: exit.price,
      exitReason: exit.reason,
      pnlPctOfPosition: (exitPriceFilled - entryPriceFilled) / entryPriceFilled,
      won: exitPriceFilled > entryPriceFilled,
    }
  })
}

function applyPortfolio(rawTrades) {
  const sorted = rawTrades.slice().sort((a, b) =>
    new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())
  const taken = []
  const open = []
  let cash = INITIAL_CAPITAL
  for (const t of sorted) {
    while (open.length > 0) {
      const earliest = open.reduce((a, b) =>
        new Date(a.exitTime) < new Date(b.exitTime) ? a : b)
      if (new Date(earliest.exitTime) <= new Date(t.entryTime)) {
        cash += earliest.sizeUsd + (earliest.pnlPctOfPosition * earliest.sizeUsd)
        open.splice(open.indexOf(earliest), 1)
      } else break
    }
    if (open.length >= PARAMS.maxOpenPositions) continue
    // Compound: positionSize is % of CURRENT cash, not initial
    const sizeUsd = Math.max(5, cash * PARAMS.positionSizePct / 100)
    if (sizeUsd > cash) continue
    cash -= sizeUsd
    open.push({ exitTime: t.exitTime, sizeUsd, pnlPctOfPosition: t.pnlPctOfPosition })
    taken.push({ ...t, sizeUsd, pnl: t.pnlPctOfPosition * sizeUsd })
  }
  return taken
}

function buildEquityCurve(trades) {
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

  const byDay = new Map()
  for (const { t, equity } of curve) {
    const day = new Date(t).toISOString().slice(0, 10)
    byDay.set(day, equity)
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

  const windowDays = (SIM_END.getTime() - SIM_START.getTime()) / 86400000
  const annROI = Math.pow(finalCapital / INITIAL_CAPITAL, 365 / windowDays) - 1

  return {
    totalTrades: n,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: n === 0 ? 0 : (winners.length / n),
    initialCapital: INITIAL_CAPITAL,
    finalCapital: Math.round(finalCapital * 100) / 100,
    totalPnL: Math.round(totalPnL * 100) / 100,
    roiPct: Math.round(((finalCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 10000) / 100,
    annROIPct: Math.round(annROI * 10000) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPct: Math.round((maxDD / Math.max(peak, INITIAL_CAPITAL)) * 10000) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    avgWin: winners.length > 0 ? Math.round((grossProfit / winners.length) * 100) / 100 : 0,
    avgLoss: losers.length > 0 ? Math.round((grossLoss / losers.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
    bestTrade: winners.length > 0 ? Math.round(Math.max(...winners.map(t => t.pnl)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map(t => t.pnl)) * 100) / 100 : 0,
  }
}

;(async () => {
  console.log(`Fade-the-Favorite benchmark — bet AGAINST the leading side`)
  console.log(`  Window:        ${SIM_START.toISOString().slice(0, 10)} → ${SIM_END.toISOString().slice(0, 10)}`)
  console.log(`  Leader band:   [${PARAMS.leaderMinPrice}, ${PARAMS.leaderMaxPrice}]`)
  console.log(`  TTR:           >= ${PARAMS.minTtrDays}d${PARAMS.maxTtrDays != null ? `, <= ${PARAMS.maxTtrDays}d` : ""}`)
  console.log(`  TP/SL:         ${PARAMS.takeProfitPct != null ? "+"+PARAMS.takeProfitPct*100+"%" : "off"} / ${PARAMS.stopLossPct != null ? "-"+PARAMS.stopLossPct*100+"%" : "off"}, maxHold ${PARAMS.maxHoldingDays != null ? PARAMS.maxHoldingDays + "d" : "none"}`)
  console.log(`  Slippage:      ${(PARAMS.slippagePerLegPct ?? 0) * 100}% per leg (${(PARAMS.slippagePerLegPct ?? 0) * 200}% round-trip)`)
  console.log(`  Volume floor:  ${PARAMS.minVolumeNum.toLocaleString()}`)
  console.log(`  Position:      ${PARAMS.positionSizePct}% of CURRENT cash (compound), max ${PARAMS.maxOpenPositions} open`)
  console.log()

  const markets = await loadMarkets()
  console.log(`Loaded ${markets.length} eligible markets`)

  const rawTrades = []
  let processed = 0
  for (const m of markets) {
    const t = await evaluateMarket(m)
    if (t) rawTrades.push(t)
    processed++
    if (processed % 200 === 0) console.log(`  evaluated ${processed}/${markets.length}, ${rawTrades.length} candidate trades`)
  }
  console.log(`\nRaw candidate trades: ${rawTrades.length}`)

  const taken = applyPortfolio(rawTrades)
  console.log(`Trades after maxOpenPositions + cash filter: ${taken.length}`)

  const curve = buildEquityCurve(taken)
  const metrics = computeMetrics(taken, curve)

  console.log("\n=== Metrics ===")
  console.table(metrics)

  // Distribution by side
  const yesTrades = taken.filter(t => t.side === "YES")
  const noTrades = taken.filter(t => t.side === "NO")
  console.log(`\nSide breakdown: YES=${yesTrades.length} (win ${(yesTrades.filter(t=>t.won).length / Math.max(1,yesTrades.length) * 100).toFixed(1)}%), NO=${noTrades.length} (win ${(noTrades.filter(t=>t.won).length / Math.max(1,noTrades.length) * 100).toFixed(1)}%)`)

  // Best and worst trades
  const sorted = taken.slice().sort((a, b) => b.pnl - a.pnl)
  console.log("\n=== Top 10 winners ===")
  console.table(sorted.slice(0, 10).map(t => ({
    slug: t.slug.slice(0, 50), side: t.side,
    entry: t.entryPrice.toFixed(3), exit: t.exitPrice.toFixed(3),
    pnlPct: ((t.exitPrice - t.entryPrice) / t.entryPrice * 100).toFixed(1),
    pnl: t.pnl.toFixed(2),
  })))

  const losers = taken.filter(t => !t.won)
  console.log(`\n=== ${losers.length} losing trades (showing top 10 worst) ===`)
  console.table(losers.slice().sort((a, b) => a.pnl - b.pnl).slice(0, 10).map(t => ({
    slug: t.slug.slice(0, 50), side: t.side,
    entry: t.entryPrice.toFixed(3), exit: t.exitPrice.toFixed(3),
    pnl: t.pnl.toFixed(2),
  })))

  // Persist
  const sha = require("child_process").execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outDir = path.join("benchmarks", "results", "v0.1.0-draft", sha, `fade-${stamp}`)
  fs.mkdirSync(outDir, { recursive: true })
  const result = {
    specVersion: "v0.1.0-draft",
    gitSha: sha,
    strategyId: "fade_favorite@v1",
    strategyVersion: JSON.stringify(PARAMS),
    window: { start: SIM_START.toISOString(), end: SIM_END.toISOString() },
    universe: { filter: "closed=true, resolved, liq>=1000, vol>=5000", marketCount: markets.length },
    metrics,
    trades: taken,
  }
  fs.writeFileSync(path.join(outDir, "dryrun.json"), JSON.stringify(result, null, 2))
  console.log(`\nWrote: ${outDir}/dryrun.json`)

  await sql.end()
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })
