"use strict"
const postgres = require("postgres")
const CLOB_BASE = "https://clob.polymarket.com"
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

process.on("uncaughtException", (e) => { console.error("UNCAUGHT:", e.message, e.code, e.stack); process.exit(1) })
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.message, e?.code, e?.stack); process.exit(1) })

const CHUNK_SECS = 14 * 86400

async function fetchCandlesChunk(tokenId, chunkStart, chunkEnd) {
  const p = new URLSearchParams({ market: tokenId, startTs: String(Math.floor(chunkStart)), endTs: String(Math.floor(chunkEnd)), fidelity: "60" })
  const url = `${CLOB_BASE}/prices-history?${p}`
  const controller = new AbortController()
  const timer = setTimeout(() => { console.log("  timeout fired"); controller.abort() }, 25000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) { clearTimeout(timer); return [] }
    const data = await res.json()
    clearTimeout(timer)
    return Array.isArray(data?.history) ? data.history : []
  } catch (e) {
    clearTimeout(timer)
    console.log("  fetch error:", e.message, e.code)
    return []
  }
}

async function main() {
  const rows = await sql`
    SELECT slug, "clobTokenIdsJson", "startDate", "endDate"
    FROM "PolymarketMarket"
    WHERE closed = true AND "endDate" >= ${"2024-07-01"} AND "endDate" <= ${"2024-12-31"}
    AND "winningOutcomeIndex" IS NOT NULL
    ORDER BY "volumeNum" DESC NULLS LAST
    LIMIT 135
  `
  const m = rows[126]  // index 126 = market 127
  console.log("Market 127:", m.slug)
  const ids = JSON.parse(m.clobTokenIdsJson || "[]")
  const tokenId = String(ids[0] || "").trim()
  const startTs = Math.floor(new Date(m.startDate || "2024-07-01").getTime() / 1000)
  const endTs = Math.floor(new Date(m.endDate || "2024-12-31").getTime() / 1000)
  console.log("Token:", tokenId.slice(0,20)+"... | range:", startTs, "-", endTs)

  // Test 3 chunks
  let cursor = startTs
  let total = 0
  for (let i = 0; i < 3 && cursor < endTs; i++) {
    const chunkEnd = Math.min(cursor + CHUNK_SECS, endTs)
    console.log(`chunk ${i+1}: ${cursor} -> ${chunkEnd}`)
    const pts = await fetchCandlesChunk(tokenId, cursor, chunkEnd)
    console.log(`  got ${pts.length} points`)
    total += pts.length
    cursor = chunkEnd
  }
  console.log("Total from 3 chunks:", total)
  await sql.end()
  console.log("Done")
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })
