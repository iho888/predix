"use strict"
const postgres = require("postgres")
const CRDB = process.env.CRDB_URL || process.env.DATABASE_URL
if (!CRDB) { console.error("CRDB_URL or DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(CRDB, { ssl: "require", max: 3 })

// ── Load all eligible markets + their candles once ────────────────────────────
async function loadData(simStart, simEnd) {
  const markets = await sql`
    SELECT slug, question, "endDate", "winningOutcomeIndex",
           "liquidityNum", "volumeNum"
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "endDate" BETWEEN ${simStart} AND ${simEnd}
      AND "winningOutcomeIndex" IS NOT NULL
      AND "liquidityNum" IS NOT NULL
      AND "volumeNum" IS NOT NULL
  `
  if (markets.length === 0) return { markets: [], candlesBySlug: new Map() }

  const slugs = markets.map(m => m.slug)
  const candles = await sql`
    SELECT "marketSlug", timestamp, "yesPrice"
    FROM "PolymarketPriceCandle"
    WHERE "marketSlug" = ANY(${slugs})
      AND timestamp BETWEEN ${simStart} AND ${simEnd}
    ORDER BY timestamp ASC
  `

  const candlesBySlug = new Map()
  for (const c of candles) {
    const list = candlesBySlug.get(c.marketSlug)
    if (list) list.push(c)
    else candlesBySlug.set(c.marketSlug, [c])
  }

  return { markets, candlesBySlug }
}

// ── Run one backtest with given params ────────────────────────────────────────
function runBacktest(markets, candlesBySlug, params) {
  const {
    minPrice, maxPrice, endWithinDays,
    minLiquidity, minVolume,
    takeProfitPct, stopLossPct, maxHoldingDays,
    positionSizePct, maxOpenPositions,
  } = params

  let cash = 10000
  const INITIAL = 10000
  const open = new Map()
  const trades = []

  // Merge all candle ticks into one timeline
  const allTicks = []
  for (const [slug, candles] of candlesBySlug) {
    for (const c of candles) allTicks.push({ slug, ...c })
  }
  allTicks.sort((a, b) => a.timestamp - b.timestamp)

  const marketBySlug = new Map(markets.map(m => [m.slug, m]))

  for (const tick of allTicks) {
    const m = marketBySlug.get(tick.slug)
    if (!m) continue
    const now = new Date(tick.timestamp)
    const endDate = new Date(m.endDate)
    const yesP = Math.max(0, Math.min(1, tick.yesPrice))
    const noP = 1 - yesP
    const leading = yesP >= noP ? { side: "YES", price: yesP } : { side: "NO", price: noP }

    // Exit
    if (open.has(tick.slug)) {
      const pos = open.get(tick.slug)
      const curPrice = pos.side === "YES" ? yesP : noP
      const pnlPct = (curPrice - pos.entryPrice) / pos.entryPrice
      const holdingDays = (now - pos.entryTime) / 86400_000

      let exitPrice = null, reason = null

      if (now >= endDate) {
        exitPrice = pos.side === "YES"
          ? (m.winningOutcomeIndex === 0 ? 1 : 0)
          : (m.winningOutcomeIndex === 1 ? 1 : 0)
        reason = "resolution"
      } else if (pnlPct >= takeProfitPct / 100) {
        exitPrice = curPrice; reason = "take_profit"
      } else if (pnlPct <= -stopLossPct / 100) {
        exitPrice = curPrice; reason = "stop_loss"
      } else if (holdingDays >= maxHoldingDays) {
        exitPrice = curPrice; reason = "max_holding"
      }

      if (exitPrice !== null) {
        const pnl = pos.shares * (exitPrice - pos.entryPrice)
        cash += pos.sizeUsd + pnl
        trades.push({ pnl, won: pnl > 0, reason, entryPrice: pos.entryPrice, exitPrice })
        open.delete(tick.slug)
      }
      continue
    }

    // Entry
    if (open.size >= maxOpenPositions) continue
    if (now >= endDate) continue
    if (leading.price < minPrice || leading.price > maxPrice) continue
    if ((m.liquidityNum ?? 0) < minLiquidity) continue
    if ((m.volumeNum ?? 0) < minVolume) continue
    const daysToEnd = (endDate - now) / 86400_000
    if (endWithinDays > 0 && daysToEnd > endWithinDays) continue

    const sizeUsd = Math.max(5, (cash * positionSizePct) / 100)
    if (sizeUsd > cash) continue

    open.set(tick.slug, {
      side: leading.side,
      entryPrice: leading.price,
      entryTime: now,
      sizeUsd,
      shares: sizeUsd / leading.price,
    })
    cash -= sizeUsd
  }

  const n = trades.length
  if (n < 3) return null // too few trades to be meaningful

  const winners = trades.filter(t => t.won)
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
  const roi = (totalPnL / INITIAL) * 100
  const winRate = (winners.length / n) * 100

  return { n, winRate, roi, totalPnL, winCount: winners.length }
}

// ── Grid search ───────────────────────────────────────────────────────────────
async function main() {
  const SIM_START = new Date("2024-01-01")
  const SIM_END   = new Date("2024-12-31")

  console.log(`Loading data ${SIM_START.toISOString().slice(0,10)} → ${SIM_END.toISOString().slice(0,10)}...`)
  const { markets, candlesBySlug } = await loadData(SIM_START, SIM_END)
  console.log(`Loaded ${markets.length} markets, ${[...candlesBySlug.values()].reduce((s,v)=>s+v.length,0).toLocaleString()} candles\n`)

  const results = []

  // Grid: focus on high-prob bond style variations
  const minPrices       = [0.75, 0.80, 0.85, 0.88, 0.90, 0.92]
  const maxPrices       = [0.99, 0.97, 0.95]
  const endWithinDayss  = [5, 7, 10, 14, 21, 0] // 0 = no filter
  const minLiquidities  = [500, 2000, 5000]
  const minVolumes      = [1000, 5000, 20000]
  const takeProfits     = [2, 3, 5]
  const stopLosses      = [8, 12, 20]
  const maxHoldings     = [7, 14, 21]

  let total = minPrices.length * maxPrices.length * endWithinDayss.length *
              minLiquidities.length * minVolumes.length * takeProfits.length *
              stopLosses.length * maxHoldings.length
  console.log(`Running ${total.toLocaleString()} parameter combinations...`)

  let done = 0
  for (const minPrice of minPrices)
  for (const maxPrice of maxPrices) {
    if (maxPrice <= minPrice) continue
    for (const endWithinDays of endWithinDayss)
    for (const minLiquidity of minLiquidities)
    for (const minVolume of minVolumes)
    for (const takeProfitPct of takeProfits)
    for (const stopLossPct of stopLosses)
    for (const maxHoldingDays of maxHoldings) {
      const params = {
        minPrice, maxPrice, endWithinDays, minLiquidity, minVolume,
        takeProfitPct, stopLossPct, maxHoldingDays,
        positionSizePct: 5, maxOpenPositions: 10,
      }
      const r = runBacktest(markets, candlesBySlug, params)
      if (r) results.push({ params, ...r })
      done++
      if (done % 5000 === 0) process.stdout.write(`\r  ${done.toLocaleString()}/${total.toLocaleString()} combos tested, ${results.length} valid...`)
    }
  }
  console.log(`\n\nValid results (≥3 trades): ${results.length}`)

  // ── Top by ROI (min 5 trades) ─────────────────────────────────────────────
  const qualified = results.filter(r => r.n >= 5)
  qualified.sort((a, b) => b.roi - a.roi)

  console.log("\n── Top 15 by ROI (min 5 trades) ─────────────────────────────────────────")
  console.log("ROI%    WinRate  Trades  minP  maxP  endD  minLiq  minVol  TP%  SL%  hold")
  for (const r of qualified.slice(0, 15)) {
    const p = r.params
    console.log(
      `${r.roi.toFixed(1).padStart(7)}% ` +
      `${r.winRate.toFixed(0).padStart(6)}%  ` +
      `${String(r.n).padStart(6)}  ` +
      `${p.minPrice.toFixed(2)}  ${p.maxPrice.toFixed(2)}  ` +
      `${String(p.endWithinDays || "any").padStart(4)}  ` +
      `${String(p.minLiquidity).padStart(6)}  ` +
      `${String(p.minVolume).padStart(6)}  ` +
      `${p.takeProfitPct}%  ${p.stopLossPct}%  ${p.maxHoldingDays}d`
    )
  }

  // ── Top by win rate (min 10 trades) ──────────────────────────────────────
  const qualified10 = results.filter(r => r.n >= 10)
  qualified10.sort((a, b) => b.winRate - a.winRate || b.n - a.n)
  console.log("\n── Top 10 by Win Rate (min 10 trades) ────────────────────────────────────")
  console.log("WinRate  ROI%    Trades  minP  maxP  endD  minLiq  minVol  TP%  SL%  hold")
  for (const r of qualified10.slice(0, 10)) {
    const p = r.params
    console.log(
      `${r.winRate.toFixed(0).padStart(6)}%  ` +
      `${r.roi.toFixed(1).padStart(7)}%  ` +
      `${String(r.n).padStart(6)}  ` +
      `${p.minPrice.toFixed(2)}  ${p.maxPrice.toFixed(2)}  ` +
      `${String(p.endWithinDays || "any").padStart(4)}  ` +
      `${String(p.minLiquidity).padStart(6)}  ` +
      `${String(p.minVolume).padStart(6)}  ` +
      `${p.takeProfitPct}%  ${p.stopLossPct}%  ${p.maxHoldingDays}d`
    )
  }

  // ── Best balanced (ROI>5%, winRate>70%, n>=8) ─────────────────────────────
  const balanced = results.filter(r => r.n >= 8 && r.roi > 5 && r.winRate >= 70)
  balanced.sort((a, b) => (b.roi * b.winRate) - (a.roi * a.winRate))
  console.log(`\n── Best Balanced (ROI>5%, WinRate≥70%, ≥8 trades): ${balanced.length} combos ──`)
  if (balanced.length > 0) {
    console.log("ROI%    WinRate  Trades  minP  maxP  endD  minLiq  minVol  TP%  SL%  hold")
    for (const r of balanced.slice(0, 10)) {
      const p = r.params
      console.log(
        `${r.roi.toFixed(1).padStart(7)}% ` +
        `${r.winRate.toFixed(0).padStart(6)}%  ` +
        `${String(r.n).padStart(6)}  ` +
        `${p.minPrice.toFixed(2)}  ${p.maxPrice.toFixed(2)}  ` +
        `${String(p.endWithinDays || "any").padStart(4)}  ` +
        `${String(p.minLiquidity).padStart(6)}  ` +
        `${String(p.minVolume).padStart(6)}  ` +
        `${p.takeProfitPct}%  ${p.stopLossPct}%  ${p.maxHoldingDays}d`
      )
    }
  }

  await sql.end()
}

main().catch(e => { console.error(e.message); process.exit(1) })
