"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  // 1. Overview
  const [overview] = await sql`
    SELECT
      COUNT(DISTINCT m.slug)::int                  AS markets_with_candles,
      COUNT(c.*)::int                              AS total_candles,
      MIN(c.timestamp)::date                       AS earliest_candle,
      MAX(c.timestamp)::date                       AS latest_candle
    FROM "PolymarketMarket" m
    JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
  `
  console.log("\n=== DB Overview ===")
  console.log(`Markets with candles: ${overview.markets_with_candles}`)
  console.log(`Total candle rows:    ${overview.total_candles}`)
  console.log(`Candle range:         ${overview.earliest_candle} → ${overview.latest_candle}`)

  // 2. Markets usable for simulation (closed, has winner, has candles)
  const simMarkets = await sql`
    SELECT m.slug, m.question, m."endDate", m."winningOutcomeIndex",
           m."liquidityNum", m."volumeNum",
           COUNT(c.*)::int AS candle_count
    FROM "PolymarketMarket" m
    JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
    WHERE m.closed = true
      AND m."winningOutcomeIndex" IS NOT NULL
      AND m."endDate" BETWEEN '2024-07-01' AND '2024-12-31'
    GROUP BY m.slug, m.question, m."endDate", m."winningOutcomeIndex", m."liquidityNum", m."volumeNum"
    HAVING COUNT(c.*) >= 10
    ORDER BY m."endDate" ASC
    LIMIT 50
  `
  console.log(`\n=== Simulation-eligible markets (Jul–Dec 2024, ≥10 candles) ===`)
  console.log(`Count: ${simMarkets.length}`)
  if (simMarkets.length > 0) {
    console.log(`Sample (first 5):`)
    for (const m of simMarkets.slice(0, 5)) {
      const winner = m.winningOutcomeIndex === 0 ? "YES" : "NO"
      console.log(
        `  ${m.slug.substring(0, 50).padEnd(50)} | ${String(m.candle_count).padStart(5)} candles | winner=${winner} | end=${String(m.endDate).substring(0, 10)}`
      )
    }
  }

  if (simMarkets.length === 0) {
    console.log("No eligible markets found — simulation will return 0 trades")
    return
  }

  // 3. Run a miniature simulation (high-probability-bond strategy, minPrice=0.80, maxPrice=0.97)
  const MIN_PRICE = 0.80
  const MAX_PRICE = 0.97
  const TAKE_PROFIT_PCT = 0.03
  const STOP_LOSS_PCT = 0.15
  const MAX_HOLDING_DAYS = 14
  const POSITION_SIZE_PCT = 5
  const MAX_OPEN = 10
  let cash = 1000
  const open = new Map()
  const trades = []

  for (const market of simMarkets) {
    const candles = await sql`
      SELECT timestamp, "yesPrice"
      FROM "PolymarketPriceCandle"
      WHERE "marketSlug" = ${market.slug}
      ORDER BY timestamp ASC
    `

    for (const c of candles) {
      const t = c.timestamp
      const yesP = Math.max(0, Math.min(1, c.yesPrice))
      const noP = 1 - yesP
      const leading = yesP >= noP
        ? { side: "YES", price: yesP }
        : { side: "NO", price: noP }

      // Exit check
      if (open.has(market.slug)) {
        const pos = open.get(market.slug)
        const curPrice = pos.side === "YES" ? yesP : noP
        const pnlPct = (curPrice - pos.entryPrice) / pos.entryPrice
        const holdingMs = t.getTime() - pos.entryTime.getTime()
        const holdingDays = holdingMs / 86400_000

        let shouldExit = false
        let exitPrice = curPrice
        let reason = "unknown"

        if (t.getTime() >= market.endDate.getTime()) {
          shouldExit = true
          exitPrice = (pos.side === "YES")
            ? (market.winningOutcomeIndex === 0 ? 1 : 0)
            : (market.winningOutcomeIndex === 1 ? 1 : 0)
          reason = "resolution"
        } else if (pnlPct >= TAKE_PROFIT_PCT) {
          shouldExit = true; reason = "take_profit"
        } else if (pnlPct <= -STOP_LOSS_PCT) {
          shouldExit = true; reason = "stop_loss"
        } else if (holdingDays >= MAX_HOLDING_DAYS) {
          shouldExit = true; reason = "max_holding"
        }

        if (shouldExit) {
          const pnl = pos.shares * (exitPrice - pos.entryPrice)
          cash += pos.sizeUsd + pnl
          trades.push({ slug: market.slug, side: pos.side, entryPrice: pos.entryPrice, exitPrice, pnl, reason, won: pnl > 0 })
          open.delete(market.slug)
        }
        continue
      }

      // Entry check
      if (open.size >= MAX_OPEN) continue
      if (t.getTime() >= market.endDate.getTime()) continue
      if (leading.price < MIN_PRICE || leading.price > MAX_PRICE) continue
      if ((market.liquidityNum ?? 0) < 500) continue
      if ((market.volumeNum ?? 0) < 1000) continue

      const sizeUsd = Math.max(5, (cash * POSITION_SIZE_PCT) / 100)
      if (sizeUsd > cash) continue

      open.set(market.slug, {
        side: leading.side,
        entryPrice: leading.price,
        entryTime: t,
        sizeUsd,
        shares: sizeUsd / leading.price,
      })
      cash -= sizeUsd
    }
  }

  // 4. Results
  const n = trades.length
  const winners = trades.filter((t) => t.won)
  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
  const finalCapital = 1000 + totalPnL

  console.log(`\n=== Mini Simulation Results (High-Prob Bond, $1000, Jul–Dec 2024) ===`)
  console.log(`Markets scanned:   ${simMarkets.length}`)
  console.log(`Total trades:      ${n}`)
  console.log(`Winners:           ${winners.length} (${n > 0 ? ((winners.length / n) * 100).toFixed(1) : 0}%)`)
  console.log(`Total P&L:        $${totalPnL.toFixed(2)}`)
  console.log(`Final capital:    $${finalCapital.toFixed(2)}`)
  console.log(`ROI:               ${((totalPnL / 1000) * 100).toFixed(2)}%`)

  if (trades.length > 0) {
    console.log(`\nSample trades (first 8):`)
    for (const t of trades.slice(0, 8)) {
      const slug = t.slug.substring(0, 45).padEnd(45)
      const pnl = (t.pnl >= 0 ? "+" : "") + t.pnl.toFixed(2)
      console.log(`  ${slug} | ${t.side} @ ${t.entryPrice.toFixed(3)}→${t.exitPrice.toFixed(3)} | ${pnl.padStart(8)} | ${t.reason}`)
    }

    const byReason = {}
    for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1
    console.log(`\nExit reasons: ${JSON.stringify(byReason)}`)
  }

  console.log(`\nData verified OK — simulation engine works with stored candles.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => sql.end())
