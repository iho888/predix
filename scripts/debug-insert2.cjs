"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  // Check DB size
  const [size] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`
  console.log("DB size:", size.db_size)

  // Check if market 127 exists and has no candles
  const rows = await sql`
    SELECT slug, "clobTokenIdsJson", "startDate", "endDate"
    FROM "PolymarketMarket"
    WHERE slug = 'will-wesley-hunt-win-the-2024-republican-vp-nomination'
  `
  if (!rows.length) { console.log("Market 127 not found"); await sql.end(); return }
  const m = rows[0]
  const ids = JSON.parse(m.clobTokenIdsJson || "[]")
  const tokenId = String(ids[0] || "").trim()
  console.log("Market:", m.slug, "| tokenId:", tokenId.slice(0,20)+"...")

  const [cnt] = await sql`SELECT COUNT(*) AS c FROM "PolymarketPriceCandle" WHERE "marketSlug" = ${m.slug}`
  console.log("Existing candles for this market:", cnt.c)

  // Test insert 5 fake rows with the new schema (no id)
  const testRows = [
    { marketSlug: m.slug, timestamp: "2024-07-01T00:00:00.000Z", yesPrice: 0.5 },
    { marketSlug: m.slug, timestamp: "2024-07-01T01:00:00.000Z", yesPrice: 0.51 },
    { marketSlug: m.slug, timestamp: "2024-07-01T02:00:00.000Z", yesPrice: 0.52 },
  ]
  try {
    const res = await sql`
      INSERT INTO "PolymarketPriceCandle" ${sql(testRows, 'marketSlug', 'timestamp', 'yesPrice')}
      ON CONFLICT DO NOTHING
    `
    console.log("Test insert succeeded, count:", res.count)
    // Clean up
    await sql`DELETE FROM "PolymarketPriceCandle" WHERE "marketSlug" = ${m.slug} AND timestamp < '2024-07-02'`
    console.log("Test rows cleaned up")
  } catch (e) {
    console.error("Test insert FAILED:", e.message)
  }

  await sql.end()
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })
