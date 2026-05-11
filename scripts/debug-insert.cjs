"use strict"
const postgres = require("postgres")
const CLOB_BASE = "https://clob.polymarket.com"
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }

const sql = postgres(DB_URL, { ssl: "require", max: 3, idle_timeout: 20, connect_timeout: 30 })

process.on("uncaughtException", (e) => { console.error("UNCAUGHT:", e.message, "\n", e.stack); process.exit(1) })
process.on("unhandledRejection", (e) => { console.error("UNHANDLED:", e?.message, "\n", e?.stack); process.exit(1) })

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

const CHUNK_SECS = 14 * 86400

async function fetchCandlesChunk(tokenId, chunkStart, chunkEnd) {
  const p = new URLSearchParams({
    market: tokenId,
    startTs: String(Math.floor(chunkStart)),
    endTs: String(Math.floor(chunkEnd)),
    fidelity: "60",
  })
  const url = `${CLOB_BASE}/prices-history?${p}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) { clearTimeout(timer); console.log("  non-ok response:", res.status); return [] }
    const data = await res.json()
    clearTimeout(timer)
    if (!data || !Array.isArray(data.history)) return []
    return data.history.filter((r) => typeof r?.t === "number" && typeof r?.p === "number")
  } catch (e) {
    clearTimeout(timer)
    console.error("  fetch error:", e.message)
    return []
  }
}

async function fetchCandles(tokenId, startTs, endTs) {
  const all = []
  let cursor = Math.floor(startTs)
  const end = Math.floor(endTs)
  let chunkNum = 0
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + CHUNK_SECS, end)
    chunkNum++
    console.log(`  chunk ${chunkNum}: ${cursor} -> ${chunkEnd}`)
    const pts = await fetchCandlesChunk(tokenId, cursor, chunkEnd)
    console.log(`  chunk ${chunkNum}: got ${pts.length} points`)
    all.push(...pts)
    cursor = chunkEnd
  }
  return all
}

async function main() {
  // Get market 111 (kari-lake)
  const rows = await sql`
    SELECT slug, "clobTokenIdsJson", "startDate", "endDate"
    FROM "PolymarketMarket"
    WHERE slug = 'will-kari-lake-win-the-2024-republican-vp-nomination'
    LIMIT 1
  `
  if (!rows.length) { console.error("Market not found"); process.exit(1) }
  const m = rows[0]
  const ids = JSON.parse(m.clobTokenIdsJson || "[]")
  const tokenId = String(ids[0] || "").trim()
  console.log("Market:", m.slug)
  console.log("TokenId:", tokenId.slice(0, 20) + "...")
  console.log("Start:", m.startDate, "End:", m.endDate)

  const startTs = Math.floor(new Date(m.startDate || "2024-07-01").getTime() / 1000)
  const endTs = Math.floor(new Date(m.endDate || "2024-12-31").getTime() / 1000)
  console.log(`Fetching candles: ${startTs} -> ${endTs}`)

  const candles = await fetchCandles(tokenId, startTs, endTs)
  console.log(`Total candles: ${candles.length}`)

  // Now insert them
  const rows2 = candles.map((pt) => ({
    id: `${m.slug}_${pt.t}`,
    marketSlug: m.slug,
    timestamp: new Date(pt.t * 1000).toISOString(),
    yesPrice: Math.max(0, Math.min(1, pt.p)),
  }))

  const BATCH = 500
  let added = 0
  for (let i = 0; i < rows2.length; i += BATCH) {
    const batch = rows2.slice(i, i + BATCH)
    console.log(`Inserting batch ${Math.floor(i/BATCH)+1}/${Math.ceil(rows2.length/BATCH)} (${batch.length} rows)...`)
    try {
      const res = await sql`
        INSERT INTO "PolymarketPriceCandle" ${sql(batch, 'id', 'marketSlug', 'timestamp', 'yesPrice')}
        ON CONFLICT DO NOTHING
      `
      added += res.count
      console.log(`  batch done, count=${res.count}`)
    } catch (e) {
      console.error(`  batch error: ${e.message}`)
    }
  }
  console.log(`Done. Inserted ${added}/${candles.length} candles`)
  await sql.end()
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1) })
