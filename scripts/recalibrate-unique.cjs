"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 2 })

function bucketCase(col) {
  return `CASE
    WHEN ${col} >= 0.95 THEN '95-100'
    WHEN ${col} >= 0.90 THEN '90-95'
    WHEN ${col} >= 0.85 THEN '85-90'
    WHEN ${col} >= 0.80 THEN '80-85'
    WHEN ${col} >= 0.70 THEN '70-80'
    WHEN ${col} >= 0.50 THEN '50-70'
    ELSE '<50'
  END`
}

async function main() {
  console.log("\n=== A. Unique markets that ever touched each band during [7,30] days to resolution ===")
  console.log("    (a market touching multiple bands counts in each — generous to the strategy)")
  const everTouched = await sql.unsafe(`
    WITH bucket_observations AS (
      SELECT
        m.slug,
        m."winningOutcomeIndex"::INT AS win_idx,
        ${bucketCase('c."yesPrice"')} AS bucket
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
        AND EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 BETWEEN 7 AND 30
    )
    SELECT
      bucket,
      COUNT(DISTINCT slug) AS unique_markets,
      COUNT(DISTINCT slug) FILTER (WHERE win_idx = 0) AS yes_wins,
      ROUND(100.0 * COUNT(DISTINCT slug) FILTER (WHERE win_idx = 0) / COUNT(DISTINCT slug), 2) AS yes_win_pct
    FROM bucket_observations
    GROUP BY bucket
    ORDER BY bucket DESC
  `)
  console.table(everTouched)

  console.log("\n=== B. First-entry: bucket where price FIRST entered the [7,30] day window ===")
  console.log("    (more realistic — one observation per market, the moment a trader could first act)")
  const firstEntry = await sql.unsafe(`
    WITH ranked AS (
      SELECT
        m.slug,
        m."winningOutcomeIndex"::INT AS win_idx,
        c."yesPrice",
        c."timestamp",
        ROW_NUMBER() OVER (PARTITION BY m.slug ORDER BY c."timestamp" ASC) AS rn
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
        AND EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 BETWEEN 7 AND 30
    ),
    first_only AS (
      SELECT slug, win_idx, "yesPrice"
      FROM ranked
      WHERE rn = 1
    )
    SELECT
      ${bucketCase('"yesPrice"')} AS bucket,
      COUNT(*) AS unique_markets,
      COUNT(*) FILTER (WHERE win_idx = 0) AS yes_wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE win_idx = 0) / COUNT(*), 2) AS yes_win_pct
    FROM first_only
    GROUP BY bucket
    ORDER BY bucket DESC
  `)
  console.table(firstEntry)

  console.log("\n=== C. Trade-rule simulation: 'enter on first candle where YES in [85%, 95%] within [7,30]d' ===")
  console.log("    This is closer to what Resolution Sniper would actually do.")
  const ruleSim = await sql.unsafe(`
    WITH eligible AS (
      SELECT
        m.slug,
        m."winningOutcomeIndex"::INT AS win_idx,
        c."yesPrice" AS entry_price,
        c."timestamp" AS entry_at,
        ROW_NUMBER() OVER (PARTITION BY m.slug ORDER BY c."timestamp" ASC) AS rn
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
        AND EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 BETWEEN 7 AND 30
        AND c."yesPrice" BETWEEN 0.85 AND 0.95
    ),
    entries AS (
      SELECT slug, win_idx, entry_price
      FROM eligible
      WHERE rn = 1
    )
    SELECT
      COUNT(*) AS trades,
      COUNT(*) FILTER (WHERE win_idx = 0) AS wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE win_idx = 0) / COUNT(*), 2) AS win_pct,
      ROUND(AVG(entry_price)::numeric, 4) AS avg_entry,
      ROUND((AVG(CASE WHEN win_idx = 0 THEN (1.0 - entry_price)/entry_price ELSE -1.0 END))::numeric, 4) AS avg_return_per_trade
    FROM entries
  `)
  console.table(ruleSim)

  console.log("\n=== D. Same trade rule, swept across price bands ===")
  const sweep = await sql.unsafe(`
    WITH eligible AS (
      SELECT
        m.slug,
        m."winningOutcomeIndex"::INT AS win_idx,
        c."yesPrice" AS entry_price,
        ROW_NUMBER() OVER (PARTITION BY m.slug ORDER BY c."timestamp" ASC) AS rn
      FROM "PolymarketMarket" m
      JOIN "PolymarketPriceCandle" c ON c."marketSlug" = m.slug
      WHERE m."winningOutcomeIndex" IS NOT NULL
        AND EXTRACT(EPOCH FROM (m."endDate" - c."timestamp")) / 86400.0 BETWEEN 7 AND 30
        AND c."yesPrice" >= 0.50
    ),
    entries AS (
      SELECT slug, win_idx, entry_price, ${bucketCase('entry_price')} AS bucket
      FROM eligible
      WHERE rn = 1
    )
    SELECT
      bucket,
      COUNT(*) AS trades,
      COUNT(*) FILTER (WHERE win_idx = 0) AS wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE win_idx = 0) / COUNT(*), 2) AS win_pct,
      ROUND(AVG(entry_price)::numeric, 4) AS avg_entry,
      ROUND((AVG(CASE WHEN win_idx = 0 THEN (1.0 - entry_price)/entry_price ELSE -1.0 END))::numeric, 4) AS avg_return_per_trade
    FROM entries
    GROUP BY bucket
    ORDER BY bucket DESC
  `)
  console.table(sweep)

  await sql.end()
}

main().catch(e => { console.error("FAIL", e.message); process.exit(1) })
