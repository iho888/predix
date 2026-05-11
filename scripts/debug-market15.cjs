"use strict"
const postgres = require("postgres")
const CLOB_BASE = "https://clob.polymarket.com"

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }

const sql = postgres(DB_URL, { ssl: "require", max: 2, idle_timeout: 20, connect_timeout: 30 })

process.on("uncaughtException", (e) => { console.error("UNCAUGHT:", e.message, e.stack); process.exit(1) })
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.message, e?.stack); process.exit(1) })

async function main() {
  const rows = await sql`
    SELECT slug, "clobTokenIdsJson", "startDate", "endDate"
    FROM "PolymarketMarket"
    WHERE closed = true
      AND "endDate" >= ${"2024-07-01T00:00:00Z"}
      AND "endDate" <= ${"2024-12-31T23:59:59Z"}
      AND "winningOutcomeIndex" IS NOT NULL
    ORDER BY "volumeNum" DESC NULLS LAST
    LIMIT 20
  `
  console.log("Loaded", rows.length, "markets")

  for (let i = 13; i < Math.min(20, rows.length); i++) {
    const m = rows[i]
    const ids = JSON.parse(m.clobTokenIdsJson || "[]")
    const yesTokenId = String(ids[0] || "").trim()
    console.log(`[${i+1}] ${m.slug}`)
    console.log(`     tokenId: ${yesTokenId.slice(0, 16)}... | start: ${m.startDate} | end: ${m.endDate}`)

    if (!yesTokenId) { console.log("     SKIP: no tokenId"); continue }

    const startTs = Math.floor(new Date(m.startDate || "2024-07-01").getTime() / 1000)
    const endTs = Math.floor(new Date(m.endDate || "2024-12-31").getTime() / 1000)
    const chunkEnd = Math.min(startTs + 14 * 86400, endTs)

    console.log(`     fetching first chunk: ${startTs} -> ${chunkEnd}`)

    const controller = new AbortController()
    const timer = setTimeout(() => { console.log("     TIMEOUT FIRED"); controller.abort() }, 25000)
    try {
      const p = new URLSearchParams({ market: yesTokenId, startTs: String(startTs), endTs: String(chunkEnd), fidelity: "60" })
      const url = `${CLOB_BASE}/prices-history?${p}`
      console.log("     url:", url.slice(0, 80) + "...")
      const res = await fetch(url, { signal: controller.signal })
      console.log("     response status:", res.status)
      const data = await res.json()
      clearTimeout(timer)
      console.log("     history points:", Array.isArray(data?.history) ? data.history.length : "not array")
    } catch (e) {
      clearTimeout(timer)
      console.error("     fetch error:", e.message)
    }
    break // only test the first market in range (index 13 = market 14)
  }

  await sql.end()
  console.log("Done")
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })
