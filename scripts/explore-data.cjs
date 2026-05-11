"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

async function main() {
  console.log("\n=== 1. Coverage ===")
  const cov = await sql`
    SELECT
      COUNT(*) AS markets,
      COUNT(*) FILTER (WHERE closed = true) AS closed,
      COUNT(*) FILTER (WHERE "winningOutcomeIndex" IS NOT NULL) AS resolved,
      MIN("endDate") AS earliest_end,
      MAX("endDate") AS latest_end
    FROM "PolymarketMarket"`
  console.log(cov[0])

  console.log("\n=== 2. Resolved-market YES win rate (the prior) ===")
  const winRate = await sql`
    SELECT
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE "winningOutcomeIndex" = 0) AS yes_wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE "winningOutcomeIndex" = 0) / COUNT(*), 2) AS yes_win_pct
    FROM "PolymarketMarket"
    WHERE "winningOutcomeIndex" IS NOT NULL`
  console.log(winRate[0])

  console.log("\n=== 3. Distribution of liquidity / volume on resolved markets ===")
  const dist = await sql`
    SELECT
      ROUND(AVG("liquidityNum")::numeric, 0) AS avg_liq,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY "liquidityNum") AS median_liq,
      percentile_disc(0.9) WITHIN GROUP (ORDER BY "liquidityNum") AS p90_liq,
      ROUND(AVG("volumeNum")::numeric, 0) AS avg_vol,
      percentile_disc(0.5) WITHIN GROUP (ORDER BY "volumeNum") AS median_vol,
      percentile_disc(0.9) WITHIN GROUP (ORDER BY "volumeNum") AS p90_vol
    FROM "PolymarketMarket"
    WHERE "winningOutcomeIndex" IS NOT NULL
      AND "liquidityNum" IS NOT NULL`
  console.log(dist[0])

  console.log("\n=== 4. Calibration: when YES price was 80-90% with 7-30 days left, how often did YES win? ===")
  const calib = await sql`
    WITH last_candle AS (
      SELECT m.slug,
             m."endDate",
             m."winningOutcomeIndex",
             c."yesPrice",
             c."timestamp",
             EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 AS days_to_end
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
    ),
    buckets AS (
      SELECT
        CASE
          WHEN "yesPrice" >= 0.95 THEN '95-100'
          WHEN "yesPrice" >= 0.90 THEN '90-95'
          WHEN "yesPrice" >= 0.85 THEN '85-90'
          WHEN "yesPrice" >= 0.80 THEN '80-85'
          WHEN "yesPrice" >= 0.70 THEN '70-80'
          WHEN "yesPrice" >= 0.50 THEN '50-70'
          ELSE '<50'
        END AS bucket,
        "winningOutcomeIndex" AS win_idx
      FROM last_candle
      WHERE days_to_end BETWEEN 7 AND 30
    )
    SELECT
      bucket,
      COUNT(*) AS observations,
      COUNT(*) FILTER (WHERE win_idx::INT = 0) AS yes_wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE win_idx::INT = 0) / COUNT(*), 2) AS yes_win_pct
    FROM buckets
    GROUP BY bucket
    ORDER BY bucket DESC`
  console.log(calib)

  console.log("\n=== 5. Late-entry calibration: 1-7 days to resolution ===")
  const calibLate = await sql`
    WITH last_candle AS (
      SELECT m.slug,
             m."endDate",
             m."winningOutcomeIndex",
             c."yesPrice",
             c."timestamp",
             EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 AS days_to_end
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
    ),
    buckets AS (
      SELECT
        CASE
          WHEN "yesPrice" >= 0.95 THEN '95-100'
          WHEN "yesPrice" >= 0.90 THEN '90-95'
          WHEN "yesPrice" >= 0.85 THEN '85-90'
          WHEN "yesPrice" >= 0.80 THEN '80-85'
          ELSE '<80'
        END AS bucket,
        "winningOutcomeIndex" AS win_idx
      FROM last_candle
      WHERE days_to_end BETWEEN 1 AND 7
    )
    SELECT
      bucket,
      COUNT(*) AS observations,
      COUNT(*) FILTER (WHERE win_idx::INT = 0) AS yes_wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE win_idx::INT = 0) / COUNT(*), 2) AS yes_win_pct
    FROM buckets
    GROUP BY bucket
    ORDER BY bucket DESC`
  console.log(calibLate)

  await sql.end()
}

main().catch(e => { console.error("FAIL", e.message); process.exit(1) })
