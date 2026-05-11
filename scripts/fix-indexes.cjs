"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  console.log("Dropping redundant non-unique index (already covered by unique constraint)...")
  // The _idx is redundant — _key (unique constraint) serves the same lookup purpose
  await sql`DROP INDEX IF EXISTS "PolymarketPriceCandle_marketSlug_timestamp_idx"`
  console.log("Dropped PolymarketPriceCandle_marketSlug_timestamp_idx")

  // Check new sizes
  const tables = await sql`
    SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total,
           pg_size_pretty(pg_indexes_size(relid)) AS idx
    FROM pg_stat_user_tables
    WHERE relname = 'PolymarketPriceCandle'
  `
  console.log(`PolymarketPriceCandle: total=${tables[0]?.total} indexes=${tables[0]?.idx}`)

  const [dbSize] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`
  console.log(`Total DB size now: ${dbSize.db_size}`)
  await sql.end()
}
main().catch(e => { console.error("Error:", e.message); process.exit(1) })
