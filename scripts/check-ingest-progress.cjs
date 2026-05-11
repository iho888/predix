"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

;(async () => {
  const markets = await sql`
    SELECT
      EXTRACT(YEAR FROM "endDate")::INT AS yr,
      COUNT(*) AS markets,
      COUNT(*) FILTER (WHERE "winningOutcomeIndex" IS NOT NULL) AS resolved,
      COUNT(*) FILTER (WHERE "lastSyncedAt" IS NOT NULL) AS synced
    FROM "PolymarketMarket"
    WHERE "endDate" IS NOT NULL
    GROUP BY yr
    ORDER BY yr`
  console.log("Markets by year:")
  console.table(markets)

  const candles = await sql`
    SELECT
      EXTRACT(YEAR FROM m."endDate")::INT AS yr,
      COUNT(DISTINCT c."marketSlug") AS markets_with_candles,
      COUNT(c.*) AS total_candles
    FROM "PolymarketMarket" m
    LEFT JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
    WHERE m."endDate" IS NOT NULL
    GROUP BY yr
    ORDER BY yr`
  console.log("Candles by year:")
  console.table(candles)

  await sql.end()
})().catch(e => { console.error("FAIL", e.message); process.exit(1) })
