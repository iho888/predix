"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })
async function main() {
  const [wh] = await sql`SELECT COUNT(*) AS c FROM "PolymarketPriceCandle" WHERE "marketSlug" = 'will-wesley-hunt-win-the-2024-republican-vp-nomination'`
  console.log("Wesley Hunt candles:", wh.c)
  const [all] = await sql`SELECT COUNT(DISTINCT "marketSlug") AS c FROM "PolymarketPriceCandle"`
  console.log("Markets with candles:", all.c)
  const [sz] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`
  console.log("DB size:", sz.s)
  const [total] = await sql`SELECT COUNT(*) AS c FROM "PolymarketPriceCandle"`
  console.log("Total candle rows:", total.c)
  await sql.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
