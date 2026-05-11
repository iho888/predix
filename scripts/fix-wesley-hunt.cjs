"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })
// Delete the 339 partial candles so the next ingest run re-fetches them all
async function main() {
  const res = await sql`DELETE FROM "PolymarketPriceCandle" WHERE "marketSlug" = 'will-wesley-hunt-win-the-2024-republican-vp-nomination'`
  console.log("Deleted", res.count, "partial candles for will-wesley-hunt (will be re-fetched)")
  await sql.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
