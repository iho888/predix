"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

;(async () => {
  const r = await sql`
    SELECT
      EXTRACT(YEAR FROM "endDate")::INT AS yr,
      COUNT(*) AS markets,
      COUNT(*) FILTER (WHERE "winningOutcomeIndex" IS NOT NULL) AS resolved
    FROM "PolymarketMarket"
    WHERE "endDate" IS NOT NULL
    GROUP BY yr
    ORDER BY yr`
  console.table(r)
  await sql.end()
})().catch(e => { console.error("FAIL", e.message); process.exit(1) })
