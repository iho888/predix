// Empirical calibration: for every candle in resolved markets, bucket by
// (entry_price, days_to_resolution) and measure the realized forward return
// from holding to resolution. Reveals where the empirical edge lives in
// Polymarket data. Pure SQL (B-0002 sidestep).
"use strict"
const postgres = require("postgres")
const fs = require("fs")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

// Price buckets (10pt) and time-to-resolution buckets (days)
const PRICE_BUCKETS = [
  [0.00, 0.05], [0.05, 0.10], [0.10, 0.20], [0.20, 0.30], [0.30, 0.40],
  [0.40, 0.50], [0.50, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 0.90],
  [0.90, 0.95], [0.95, 1.00],
]
const TTR_BUCKETS = [
  [0, 1], [1, 3], [3, 7], [7, 14], [14, 30], [30, 60], [60, 180], [180, 9999],
]

function priceBucketLabel(b) { return `${(b[0]*100).toFixed(0)}-${(b[1]*100).toFixed(0)}%` }
function ttrBucketLabel(b) { return b[1] >= 9999 ? `${b[0]}d+` : `${b[0]}-${b[1]}d` }

;(async () => {
  console.log("Loading resolved markets…")
  const markets = await sql`
    SELECT slug, "endDate", "winningOutcomeIndex"::INT AS "winningOutcomeIndex"
    FROM "PolymarketMarket"
    WHERE closed = true AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" IS NOT NULL`
  console.log(`  ${markets.length} markets`)

  const slugs = markets.map(m => m.slug)
  const slugMeta = new Map()
  for (const m of markets) {
    slugMeta.set(m.slug, {
      endMs: new Date(m.endDate).getTime(),
      yesResolved: Number(m.winningOutcomeIndex) === 0 ? 1 : 0, // outcome 0 = YES
    })
  }

  console.log("Loading candles for resolved markets…")
  // Stream candles to avoid loading 3M rows at once
  let processed = 0
  // cell[ priceBucketIdx ][ ttrBucketIdx ] = { yesN, yesSumPnl, yesSumSqPnl, yesWins, noN, noSumPnl, noSumSqPnl, noWins }
  const cells = PRICE_BUCKETS.map(() =>
    TTR_BUCKETS.map(() => ({ yesN:0, yesSumPnl:0, yesSumSqPnl:0, yesWins:0, noN:0, noSumPnl:0, noSumSqPnl:0, noWins:0 }))
  )

  // Use cursor-style pagination to avoid memory blowup
  const BATCH = 50000
  let offset = 0
  while (true) {
    const rows = await sql`
      SELECT "marketSlug", "timestamp", "yesPrice"
      FROM "PolymarketPriceCandle"
      WHERE "marketSlug" = ANY(${slugs})
      ORDER BY "marketSlug", "timestamp"
      LIMIT ${BATCH} OFFSET ${offset}`
    if (rows.length === 0) break

    for (const r of rows) {
      const meta = slugMeta.get(r.marketSlug)
      if (!meta) continue
      const tMs = new Date(r.timestamp).getTime()
      if (tMs >= meta.endMs) continue
      const ttrDays = (meta.endMs - tMs) / 86400000
      const yesPrice = Number(r.yesPrice)
      if (!(yesPrice > 0 && yesPrice < 1)) continue

      // Find buckets
      let pi = -1
      for (let i = 0; i < PRICE_BUCKETS.length; i++) {
        if (yesPrice >= PRICE_BUCKETS[i][0] && yesPrice < PRICE_BUCKETS[i][1]) { pi = i; break }
        if (i === PRICE_BUCKETS.length - 1 && yesPrice <= PRICE_BUCKETS[i][1]) { pi = i; break }
      }
      if (pi < 0) continue
      let ti = -1
      for (let i = 0; i < TTR_BUCKETS.length; i++) {
        if (ttrDays >= TTR_BUCKETS[i][0] && ttrDays < TTR_BUCKETS[i][1]) { ti = i; break }
      }
      if (ti < 0) continue

      const cell = cells[pi][ti]

      // YES side return: (yesResolved - yesPrice) / yesPrice
      const yesRet = (meta.yesResolved - yesPrice) / yesPrice
      cell.yesN++; cell.yesSumPnl += yesRet; cell.yesSumSqPnl += yesRet * yesRet
      if (yesRet > 0) cell.yesWins++

      // NO side return: (noResolved - noPrice) / noPrice = ((1-yesResolved) - (1-yesPrice)) / (1-yesPrice)
      const noPrice = 1 - yesPrice
      const noResolved = 1 - meta.yesResolved
      const noRet = (noResolved - noPrice) / noPrice
      cell.noN++; cell.noSumPnl += noRet; cell.noSumSqPnl += noRet * noRet
      if (noRet > 0) cell.noWins++
    }

    processed += rows.length
    if (processed % 250000 === 0) console.log(`  processed ${processed} candles…`)
    offset += rows.length
    if (rows.length < BATCH) break
  }
  console.log(`  total processed: ${processed}`)

  // Print: best opportunities by side
  console.log("\n=== EMPIRICAL EDGE TABLE (YES side, return-to-resolution) ===")
  printSideTable(cells, "yes")
  console.log("\n=== EMPIRICAL EDGE TABLE (NO side, return-to-resolution) ===")
  printSideTable(cells, "no")

  // Also print top-20 cells by Sharpe-like score (mean / std), filtering for n >= 1000
  const topCells = []
  for (let pi = 0; pi < PRICE_BUCKETS.length; pi++) {
    for (let ti = 0; ti < TTR_BUCKETS.length; ti++) {
      const c = cells[pi][ti]
      for (const side of ["yes", "no"]) {
        const n = side === "yes" ? c.yesN : c.noN
        if (n < 1000) continue
        const sumPnl = side === "yes" ? c.yesSumPnl : c.noSumPnl
        const sumSqPnl = side === "yes" ? c.yesSumSqPnl : c.noSumSqPnl
        const wins = side === "yes" ? c.yesWins : c.noWins
        const mean = sumPnl / n
        const variance = (sumSqPnl / n) - mean * mean
        const std = Math.sqrt(Math.max(0, variance))
        const score = std > 0 ? mean / std : 0
        topCells.push({
          band: priceBucketLabel(PRICE_BUCKETS[pi]),
          ttr: ttrBucketLabel(TTR_BUCKETS[ti]),
          side, n,
          meanRet: mean,
          winRate: wins / n,
          score,
        })
      }
    }
  }
  topCells.sort((a, b) => b.score - a.score)
  console.log("\n=== TOP 20 CELLS BY mean/std score (n >= 1000) ===")
  console.table(topCells.slice(0, 20).map(c => ({
    band: c.band, ttr: c.ttr, side: c.side, n: c.n,
    meanRetPct: (c.meanRet * 100).toFixed(2),
    winRatePct: (c.winRate * 100).toFixed(1),
    score: c.score.toFixed(3),
  })))

  // Persist for future analysis
  fs.writeFileSync("scripts/calibrate-out.json", JSON.stringify({
    priceBuckets: PRICE_BUCKETS, ttrBuckets: TTR_BUCKETS, cells,
    generatedAt: new Date().toISOString(),
    totalCandlesProcessed: processed,
  }, null, 2))
  console.log("\nWrote scripts/calibrate-out.json")

  await sql.end()
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })

function printSideTable(cells, side) {
  // Header
  const header = ["band\\ttr", ...TTR_BUCKETS.map(ttrBucketLabel)]
  const rows = []
  for (let pi = 0; pi < PRICE_BUCKETS.length; pi++) {
    const row = { band: priceBucketLabel(PRICE_BUCKETS[pi]) }
    for (let ti = 0; ti < TTR_BUCKETS.length; ti++) {
      const c = cells[pi][ti]
      const n = side === "yes" ? c.yesN : c.noN
      const sumPnl = side === "yes" ? c.yesSumPnl : c.noSumPnl
      const wins = side === "yes" ? c.yesWins : c.noWins
      if (n === 0) { row[ttrBucketLabel(TTR_BUCKETS[ti])] = "·"; continue }
      const mean = sumPnl / n
      const winRate = wins / n
      row[ttrBucketLabel(TTR_BUCKETS[ti])] = `${(mean*100).toFixed(1)}% w${(winRate*100).toFixed(0)} n${n>=1000?(n/1000).toFixed(0)+"k":n}`
    }
    rows.push(row)
  }
  console.table(rows)
}
