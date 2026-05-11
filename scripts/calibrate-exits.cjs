// Exit-horizon calibration for the Fade-the-Favorite strategy.
//
// For each market, simulate the strategy entry (first candle where YES is in
// [0.50, 0.90] AND TTR >= 60d) and measure realized NO-side return at multiple
// fixed hold durations: 7d, 14d, 30d, 60d, 90d, 180d, and hold-to-resolution.
//
// Output: per-(entry_band, ttr_at_entry, hold) cell mean/std/win/N. Helps find
// the optimal hold duration — currently we always hold to resolution but the
// calibration may show shorter holds capture most of the EV with less variance.
"use strict"
const postgres = require("postgres")
const fs = require("fs")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

const ENTRY_BANDS = [
  [0.50, 0.60], [0.60, 0.70], [0.70, 0.80], [0.80, 0.90],
]
const TTR_AT_ENTRY_BUCKETS = [
  [60, 120], [120, 240], [240, 365], [365, 9999],
]
const HOLD_HORIZONS = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "60d", days: 60 },
  { label: "90d", days: 90 },
  { label: "180d", days: 180 },
  { label: "resolution", days: null }, // hold to resolution
]
const MIN_TTR_DAYS = 60
const ENTRY_BAND_MIN = 0.50
const ENTRY_BAND_MAX = 0.90

function parseArg(name, fallback) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}
const FILTER_START = new Date(parseArg("--start", "2000-01-01") + "T00:00:00Z")
const FILTER_END = new Date(parseArg("--end", "2099-12-31") + "T23:59:59Z")

function bandLabel(b) { return `${(b[0]*100).toFixed(0)}-${(b[1]*100).toFixed(0)}%` }
function ttrLabel(b) { return b[1] >= 9999 ? `${b[0]}d+` : `${b[0]}-${b[1]}d` }

function findBucket(value, buckets) {
  for (let i = 0; i < buckets.length; i++) {
    if (value >= buckets[i][0] && value < buckets[i][1]) return i
    if (i === buckets.length - 1 && value <= buckets[i][1]) return i
  }
  return -1
}

;(async () => {
  console.log("Loading resolved markets…")
  const markets = await sql`
    SELECT slug, "endDate", "winningOutcomeIndex"::INT AS "winningOutcomeIndex"
    FROM "PolymarketMarket"
    WHERE closed = true AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" IS NOT NULL
      AND "endDate" BETWEEN ${FILTER_START.toISOString()} AND ${FILTER_END.toISOString()}`
  console.log(`  ${markets.length} markets`)
  const slugSet = new Set(markets.map(m => m.slug))
  const marketBySlug = new Map(markets.map(m => [m.slug, m]))

  // Stream all candles for resolved markets in pages, group by slug
  console.log("Streaming candles…")
  const candlesBySlug = new Map()
  let total = 0
  let offset = 0
  const BATCH = 100000
  while (true) {
    const rows = await sql`
      SELECT "marketSlug", "timestamp", "yesPrice"
      FROM "PolymarketPriceCandle"
      ORDER BY "marketSlug", "timestamp"
      LIMIT ${BATCH} OFFSET ${offset}`
    if (rows.length === 0) break
    for (const r of rows) {
      if (!slugSet.has(r.marketSlug)) continue
      let arr = candlesBySlug.get(r.marketSlug)
      if (!arr) { arr = []; candlesBySlug.set(r.marketSlug, arr) }
      arr.push({ ts: new Date(r.timestamp).getTime(), yesPrice: Number(r.yesPrice) })
    }
    total += rows.length
    if (total % 500000 === 0 || rows.length < BATCH) console.log(`  streamed ${total}`)
    offset += rows.length
    if (rows.length < BATCH) break
  }
  console.log(`  total streamed: ${total}, markets with candles: ${candlesBySlug.size}`)

  // cells[entryBandIdx][ttrIdx][holdIdx] = { n, sumPnl, sumSqPnl, wins }
  const cells = ENTRY_BANDS.map(() =>
    TTR_AT_ENTRY_BUCKETS.map(() =>
      HOLD_HORIZONS.map(() => ({ n: 0, sumPnl: 0, sumSqPnl: 0, wins: 0 }))
    )
  )

  let processed = 0
  let signaledMarkets = 0
  for (const m of markets) {
    const candles = candlesBySlug.get(m.slug)
    if (!candles || candles.length === 0) { processed++; continue }

    const endMs = new Date(m.endDate).getTime()
    const yesResolved = Number(m.winningOutcomeIndex) === 0 ? 1 : 0

    // Find first candle satisfying entry rule
    let entryIdx = -1
    for (let i = 0; i < candles.length; i++) {
      const yes = candles[i].yesPrice
      if (!(yes > 0 && yes < 1)) continue
      const tMs = candles[i].ts
      const ttrDays = (endMs - tMs) / 86400000
      if (ttrDays < MIN_TTR_DAYS) continue
      if (yes < ENTRY_BAND_MIN || yes > ENTRY_BAND_MAX) continue
      entryIdx = i
      break
    }
    if (entryIdx < 0) {
      processed++
      continue
    }
    signaledMarkets++

    const entry = candles[entryIdx]
    const entryYes = entry.yesPrice
    const entryNo = 1 - entryYes
    const entryMs = entry.ts
    const ttrAtEntry = (endMs - entryMs) / 86400000

    const bandIdx = findBucket(entryYes, ENTRY_BANDS)
    const ttrIdx = findBucket(ttrAtEntry, TTR_AT_ENTRY_BUCKETS)
    if (bandIdx < 0 || ttrIdx < 0) { processed++; continue }

    // For each hold horizon: find candle at entryMs + holdDays * 86400000
    for (let h = 0; h < HOLD_HORIZONS.length; h++) {
      const horizon = HOLD_HORIZONS[h]
      let exitNoPrice = null
      if (horizon.days == null) {
        // Hold to resolution
        const noResolved = 1 - yesResolved
        exitNoPrice = noResolved
      } else {
        const targetMs = entryMs + horizon.days * 86400000
        if (targetMs >= endMs) {
          // Forced exit at resolution because hold > TTR
          const noResolved = 1 - yesResolved
          exitNoPrice = noResolved
        } else {
          // Find the candle at or just after targetMs
          let exitIdx = -1
          for (let i = entryIdx + 1; i < candles.length; i++) {
            if (candles[i].ts >= targetMs) { exitIdx = i; break }
          }
          if (exitIdx < 0) {
            // No future candle — hold to resolution
            const noResolved = 1 - yesResolved
            exitNoPrice = noResolved
          } else {
            const exitYes = candles[exitIdx].yesPrice
            exitNoPrice = 1 - exitYes
          }
        }
      }
      if (exitNoPrice == null || !(exitNoPrice >= 0 && exitNoPrice <= 1)) continue
      const noRet = (exitNoPrice - entryNo) / entryNo
      const cell = cells[bandIdx][ttrIdx][h]
      cell.n++
      cell.sumPnl += noRet
      cell.sumSqPnl += noRet * noRet
      if (noRet > 0) cell.wins++
    }

    processed++
    if (processed % 200 === 0) console.log(`  evaluated ${processed}/${markets.length}, ${signaledMarkets} signaled`)
  }
  console.log(`  total processed: ${processed}, signaled: ${signaledMarkets}`)

  // Print: per (band, ttr, hold) Sharpe-like score
  const rows = []
  for (let b = 0; b < ENTRY_BANDS.length; b++) {
    for (let t = 0; t < TTR_AT_ENTRY_BUCKETS.length; t++) {
      for (let h = 0; h < HOLD_HORIZONS.length; h++) {
        const c = cells[b][t][h]
        if (c.n < 10) continue
        const mean = c.sumPnl / c.n
        const variance = (c.sumSqPnl / c.n) - mean * mean
        const std = Math.sqrt(Math.max(0, variance))
        const score = std > 0 ? mean / std : 0
        rows.push({
          band: bandLabel(ENTRY_BANDS[b]),
          ttr: ttrLabel(TTR_AT_ENTRY_BUCKETS[t]),
          hold: HOLD_HORIZONS[h].label,
          n: c.n,
          mean, std, score, winRate: c.wins / c.n,
        })
      }
    }
  }

  console.log("\n=== Top 30 cells by Sharpe-like score (n >= 10) ===")
  rows.sort((a, b) => b.score - a.score)
  console.table(rows.slice(0, 30).map(r => ({
    band: r.band, ttr: r.ttr, hold: r.hold, n: r.n,
    meanRetPct: (r.mean * 100).toFixed(1),
    stdPct: (r.std * 100).toFixed(1),
    winRate: (r.winRate * 100).toFixed(1) + "%",
    score: r.score.toFixed(3),
  })))

  console.log("\n=== Best HOLD per (band, ttr) — top 16 ===")
  const bestPerCell = new Map()
  for (const r of rows) {
    const key = `${r.band}|${r.ttr}`
    if (!bestPerCell.has(key) || bestPerCell.get(key).score < r.score) {
      bestPerCell.set(key, r)
    }
  }
  const bests = Array.from(bestPerCell.values()).sort((a, b) => b.score - a.score)
  console.table(bests.slice(0, 16).map(r => ({
    band: r.band, ttr: r.ttr, bestHold: r.hold, n: r.n,
    meanRetPct: (r.mean * 100).toFixed(1),
    winRate: (r.winRate * 100).toFixed(1) + "%",
    score: r.score.toFixed(3),
  })))

  // Persist
  fs.writeFileSync("scripts/calibrate-exits-out.json", JSON.stringify({
    entryBands: ENTRY_BANDS, ttrBuckets: TTR_AT_ENTRY_BUCKETS, holdHorizons: HOLD_HORIZONS,
    cells, generatedAt: new Date().toISOString(),
    signaledMarkets,
  }, null, 2))
  console.log("\nWrote scripts/calibrate-exits-out.json")
  await sql.end()
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })
