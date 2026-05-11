// Snapshot of how much Polymarket data we have. Pure SQL — no Prisma (B-0002).
"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

;(async () => {
  const [m] = await sql`SELECT COUNT(*)::int AS c FROM "PolymarketMarket"`
  const [mClosed] = await sql`SELECT COUNT(*)::int AS c FROM "PolymarketMarket" WHERE closed = true`
  const [mResolved] = await sql`SELECT COUNT(*)::int AS c FROM "PolymarketMarket" WHERE closed = true AND "winningOutcomeIndex" IS NOT NULL`
  const [mWithCandles] = await sql`SELECT COUNT(DISTINCT "marketSlug")::int AS c FROM "PolymarketPriceCandle"`
  const [c] = await sql`SELECT COUNT(*)::int AS c FROM "PolymarketPriceCandle"`
  const [crange] = await sql`SELECT MIN("timestamp") AS lo, MAX("timestamp") AS hi FROM "PolymarketPriceCandle"`
  const [erange] = await sql`SELECT MIN("endDate") AS lo, MAX("endDate") AS hi FROM "PolymarketMarket" WHERE "endDate" IS NOT NULL`

  // Candle coverage by year (using market endDate as the year-pivot)
  const byYear = await sql`
    SELECT EXTRACT(YEAR FROM m."endDate")::int AS yr,
           COUNT(DISTINCT m.slug)::int AS markets,
           COUNT(DISTINCT m.slug) FILTER (WHERE m."winningOutcomeIndex" IS NOT NULL)::int AS resolved,
           COUNT(DISTINCT pc."marketSlug")::int AS markets_with_candles,
           COUNT(pc.*)::int AS candle_rows
    FROM "PolymarketMarket" m
    LEFT JOIN "PolymarketPriceCandle" pc ON pc."marketSlug" = m.slug
    WHERE m."endDate" IS NOT NULL
    GROUP BY 1 ORDER BY 1`

  // Eligible-for-bench universe: closed + resolved + endDate in 2023..2024
  const [bench] = await sql`
    SELECT COUNT(*)::int AS c
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "winningOutcomeIndex" IS NOT NULL
      AND "endDate" BETWEEN '2023-01-01' AND '2024-12-30'
      AND ("liquidityNum" IS NULL OR "liquidityNum" >= 1000)
      AND ("volumeNum" IS NULL OR "volumeNum" >= 5000)`

  console.log("=== PolymarketMarket ===")
  console.log(`  total:                ${m.c}`)
  console.log(`  closed:               ${mClosed.c}`)
  console.log(`  closed + resolved:    ${mResolved.c}`)
  console.log(`  with ≥1 candle:       ${mWithCandles.c}`)
  console.log(`  endDate range:        ${erange.lo?.toISOString().slice(0, 10)} → ${erange.hi?.toISOString().slice(0, 10)}`)
  console.log(`  bench-eligible (2023-2024, liq≥1000, vol≥5000, resolved): ${bench.c}`)
  console.log()
  console.log("=== PolymarketPriceCandle ===")
  console.log(`  total rows:           ${c.c}`)
  console.log(`  timestamp range:      ${crange.lo?.toISOString().slice(0, 10)} → ${crange.hi?.toISOString().slice(0, 10)}`)
  console.log()
  console.log("=== Coverage by market endDate year ===")
  console.table(byYear.map((r) => ({
    year: r.yr,
    markets: r.markets,
    resolved: r.resolved,
    with_candles: r.markets_with_candles,
    candle_rows: r.candle_rows,
  })))

  await sql.end()
})().catch((e) => { console.error("FAIL", e.message); process.exit(1) })
