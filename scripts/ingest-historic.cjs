// Usage: node scripts/ingest-historic.cjs --start 2024-01-01 --end 2024-12-31 [--max 300]
// Uses postgres.js (pure JS) to avoid Prisma native engine crash on Windows + Node 24.
"use strict"

const postgres = require("postgres")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const GAMMA_BASE = (process.env.GAMMA_BASE_URL || "https://gamma-api.polymarket.com").replace(/\/+$/, "")
const CLOB_BASE = (process.env.CLOB_BASE_URL || "https://clob.polymarket.com").replace(/\/+$/, "")
const FIDELITY = parseInt(process.env.CANDLE_FIDELITY_MINUTES || "60", 10)
const DELAY_MS = parseInt(process.env.SYNC_DELAY_MS || "200", 10)

const sql = postgres(DB_URL, {
  ssl: "require",
  max: 3,
  idle_timeout: 20,      // drop idle connections after 20s so Neon doesn't close them first
  connect_timeout: 30,   // wait up to 30s when establishing a new connection
  connection: { application_name: "ingest-historic" },
})

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function parseArgs(argv) {
  let start = null, end = null, max = 300, skipPhase1 = false
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--start" && argv[i + 1]) start = argv[++i]
    else if (argv[i] === "--end" && argv[i + 1]) end = argv[++i]
    else if (argv[i] === "--max" && argv[i + 1]) { const n = parseInt(argv[++i], 10); if (n > 0) max = n }
    else if (argv[i] === "--skip-phase1") skipPhase1 = true
  }
  if (!start || !end) { console.error("Usage: --start YYYY-MM-DD --end YYYY-MM-DD [--max N] [--skip-phase1]"); process.exit(1) }
  const s = new Date(start + "T00:00:00Z"), e = new Date(end + "T23:59:59Z")
  if (isNaN(s) || isNaN(e) || s >= e) { console.error("Invalid dates"); process.exit(1) }
  return { startDate: s, endDate: e, maxMarkets: max, skipPhase1 }
}

function parseDateOrNull(raw) {
  if (!raw) return null
  const d = new Date(String(raw).trim())
  return isNaN(d.getTime()) ? null : d
}

function toNumOrNull(x) {
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function parseJsonArray(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

function isBinaryNonNegRisk(row) {
  if (row.neg_risk === true) return false
  const outcomes = parseJsonArray(row.outcomes)
  const tokenIds = parseJsonArray(row.clobTokenIds)
  return outcomes.length === 2 && tokenIds.length === 2
}

function inferWinner(outcomePrices) {
  const arr = parseJsonArray(outcomePrices)
  if (arr.length < 2) return null
  const p0 = Number(arr[0]), p1 = Number(arr[1])
  if (!Number.isFinite(p0) || !Number.isFinite(p1)) return null
  // Use 0.95 threshold (more permissive than 0.99)
  if (p0 >= 0.95) return 0
  if (p1 >= 0.95) return 1
  // Fallback: pick the higher price for closed markets
  if (p0 > p1) return 0
  if (p1 > p0) return 1
  return null
}

function marketEndInWindow(row, startDate, endDate) {
  const end = parseDateOrNull(row.endDate ?? row.endDateIso)
  if (!end) return false
  return end >= startDate && end <= endDate
}

// ── Gamma API ────────────────────────────────────────────────────────────────

async function fetchGammaPage(offset, pageSize, startDate, endDate) {
  // NOTE: Gamma expects `endDate` (camelCase) for the order field; the previous
  // `end_date` (snake_case) was silently ignored, so paging through 2025+ data
  // returned default-ordered results clustered around early-created markets.
  // Verified 2026-05-08: `order=endDate&ascending=false` returns markets in
  // descending endDate as expected.
  const p = new URLSearchParams({
    closed: "true", limit: String(pageSize), offset: String(offset),
    order: "endDate", ascending: "false",
    end_date_min: startDate.toISOString().slice(0, 10),
    end_date_max: endDate.toISOString().slice(0, 10),
  })
  let res = await fetch(`${GAMMA_BASE}/markets?${p}`, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    // Retry without date filters
    const p2 = new URLSearchParams({ closed: "true", limit: String(pageSize), offset: String(offset) })
    res = await fetch(`${GAMMA_BASE}/markets?${p2}`, { signal: AbortSignal.timeout(15000) })
  }
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// ── CLOB API ─────────────────────────────────────────────────────────────────

// CLOB API max window is ~15 days; chunk into 14-day segments
const CHUNK_SECS = 14 * 86400

async function fetchCandlesChunk(tokenId, chunkStart, chunkEnd, retries = 3) {
  const p = new URLSearchParams({
    market: tokenId,
    startTs: String(Math.floor(chunkStart)),
    endTs: String(Math.floor(chunkEnd)),
    fidelity: String(Math.max(60, FIDELITY)),
  })
  const url = `${CLOB_BASE}/prices-history?${p}`
  for (let attempt = 0; attempt < retries; attempt++) {
    // AbortController + setTimeout: abort() cancels the socket cleanly (no orphaned error events)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    try {
      const res = await fetch(url, { signal: controller.signal })
      if (!res.ok) { clearTimeout(timer); return [] }
      const data = await res.json()  // abort signal still active during body read
      clearTimeout(timer)
      if (!data || !Array.isArray(data.history)) return []
      return data.history.filter((r) => Number.isFinite(r?.t) && Number.isFinite(r?.p))
    } catch (e) {
      clearTimeout(timer)
      if (attempt < retries - 1) await sleep(1000 * (attempt + 1))
      else return []
    }
  }
  return []
}

async function fetchCandles(tokenId, startTs, endTs) {
  const all = []
  let cursor = Math.floor(startTs)
  const end = Math.floor(endTs)
  while (cursor < end) {
    const chunkEnd = Math.min(cursor + CHUNK_SECS, end)
    const pts = await fetchCandlesChunk(tokenId, cursor, chunkEnd)
    all.push(...pts)
    cursor = chunkEnd
  }
  // Deduplicate by timestamp and sort
  const seen = new Set()
  return all.filter((r) => {
    if (seen.has(r.t)) return false
    seen.add(r.t)
    return true
  }).sort((a, b) => a.t - b.t)
}

// ── DB upsert ────────────────────────────────────────────────────────────────

async function upsertMarket(row, now) {
  const outcomes = parseJsonArray(row.outcomes).map(String)
  const tokenIds = parseJsonArray(row.clobTokenIds).map(String)
  const closed = Boolean(row.closed)
  const winningOutcomeIndex = closed ? inferWinner(row.outcomePrices) : null

  const data = {
    slug: String(row.slug ?? "").trim(),
    question: String(row.question ?? ""),
    conditionId: String(row.conditionId ?? ""),
    outcomesJson: JSON.stringify(outcomes),
    clobTokenIdsJson: JSON.stringify(tokenIds),
    closed,
    active: Boolean(row.active),
    negRisk: Boolean(row.neg_risk),
    startDate: parseDateOrNull(row.startDate ?? row.startDateIso ?? row.createdAt),
    endDate: parseDateOrNull(row.endDate ?? row.endDateIso),
    liquidityNum: toNumOrNull(row.liquidityNum),
    volumeNum: toNumOrNull(row.volumeNum),
    winningOutcomeIndex,
    lastSyncedAt: now,
    updatedAt: now,
  }

  const existing = await sql`SELECT slug FROM "PolymarketMarket" WHERE slug = ${data.slug} LIMIT 1`
  if (existing.length === 0) {
    await sql`
      INSERT INTO "PolymarketMarket"
        (slug, question, "conditionId", "outcomesJson", "clobTokenIdsJson",
         closed, active, "negRisk", "startDate", "endDate",
         "liquidityNum", "volumeNum", "winningOutcomeIndex",
         "lastSyncedAt", "createdAt", "updatedAt")
      VALUES (
        ${data.slug}, ${data.question}, ${data.conditionId},
        ${data.outcomesJson}, ${data.clobTokenIdsJson},
        ${data.closed}, ${data.active}, ${data.negRisk},
        ${data.startDate}, ${data.endDate},
        ${data.liquidityNum}, ${data.volumeNum}, ${data.winningOutcomeIndex},
        ${data.lastSyncedAt}, ${now}, ${now}
      )
    `
    return "added"
  } else {
    await sql`
      UPDATE "PolymarketMarket" SET
        question = ${data.question}, "conditionId" = ${data.conditionId},
        "outcomesJson" = ${data.outcomesJson}, "clobTokenIdsJson" = ${data.clobTokenIdsJson},
        closed = ${data.closed}, active = ${data.active}, "negRisk" = ${data.negRisk},
        "startDate" = ${data.startDate}, "endDate" = ${data.endDate},
        "liquidityNum" = ${data.liquidityNum}, "volumeNum" = ${data.volumeNum},
        "winningOutcomeIndex" = ${data.winningOutcomeIndex},
        "lastSyncedAt" = ${data.lastSyncedAt}, "updatedAt" = ${now}
      WHERE slug = ${data.slug}
    `
    return "updated"
  }
}

async function upsertCandles(marketSlug, candles) {
  if (candles.length === 0) return 0
  const rows = candles.map((pt) => ({
    marketSlug,
    timestamp: new Date(pt.t * 1000).toISOString(),
    yesPrice: Math.max(0, Math.min(1, pt.p)),
  }))
  // Bulk insert in batches of 500 rows (postgres.js generates one multi-row VALUES query)
  const BATCH = 500
  let added = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await sql`
          INSERT INTO "PolymarketPriceCandle" ${sql(batch, 'marketSlug', 'timestamp', 'yesPrice')}
          ON CONFLICT DO NOTHING
        `
        added += res.count
        break
      } catch (e) {
        if (attempt < 2) await sleep(1000 * (attempt + 1))
      }
    }
  }
  return added
}

async function createSyncLog(syncType) {
  const res = await sql`
    INSERT INTO "DataSyncLog" (id, "startedAt", status, "syncType", "marketsAdded", "marketsUpdated", "candlesAdded")
    VALUES (
      ${Math.random().toString(36).slice(2)},
      ${new Date().toISOString()}, 'running', ${syncType}, 0, 0, 0
    )
    RETURNING id
  `
  return res[0].id
}

async function completeSyncLog(logId, { marketsAdded, marketsUpdated, candlesAdded, status = "completed", errorMessage = null }) {
  await sql`
    UPDATE "DataSyncLog" SET
      "finishedAt" = ${new Date().toISOString()},
      status = ${status},
      "marketsAdded" = ${marketsAdded},
      "marketsUpdated" = ${marketsUpdated},
      "candlesAdded" = ${candlesAdded},
      "errorMessage" = ${errorMessage}
    WHERE id = ${logId}
  `
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { startDate, endDate, maxMarkets, skipPhase1 } = parseArgs(process.argv.slice(2))
  console.log(`Ingesting: ${startDate.toISOString().slice(0,10)} → ${endDate.toISOString().slice(0,10)} (max ${maxMarkets} markets)`)

  const logId = await createSyncLog("historic-cli")
  let marketsAdded = 0, marketsUpdated = 0, candlesAdded = 0

  const upserted = [] // { slug, tokenId, startDate, endDate }

  if (skipPhase1) {
    // Load markets directly from DB
    console.log("Phase 1: skipped — loading markets from DB...")
    const rows = await sql`
      SELECT slug, "clobTokenIdsJson", "startDate", "endDate"
      FROM "PolymarketMarket"
      WHERE closed = true
        AND "endDate" >= ${startDate.toISOString()}
        AND "endDate" <= ${endDate.toISOString()}
        AND "winningOutcomeIndex" IS NOT NULL
      ORDER BY "volumeNum" DESC NULLS LAST
      LIMIT ${maxMarkets}
    `
    for (const row of rows) {
      const tokenIds = parseJsonArray(row.clobTokenIdsJson).map(String)
      const yesTokenId = tokenIds[0]?.trim()
      if (!yesTokenId) continue
      upserted.push({ slug: row.slug, yesTokenId, startDate: row.startDate ? new Date(row.startDate) : null, endDate: row.endDate ? new Date(row.endDate) : null })
    }
    console.log(`Phase 1 skipped: loaded ${upserted.length} markets from DB`)
  } else {
    const PAGE = 100
    let offset = 0
    const seen = new Set()

    // Phase 1 — fetch + upsert markets
    console.log("Phase 1: fetching markets from Gamma...")
    outer: for (let page = 0; page < 300; page++) {
      const batch = await fetchGammaPage(offset, PAGE, startDate, endDate)
      if (batch.length === 0) break

      for (const row of batch) {
        if (!row || typeof row !== "object") continue
        if (upserted.length >= maxMarkets) break outer
        if (!isBinaryNonNegRisk(row)) continue
        if (!marketEndInWindow(row, startDate, endDate)) continue

        const slug = String(row.slug ?? "").trim()
        if (!slug || seen.has(slug)) continue
        seen.add(slug)

        const tokenIds = parseJsonArray(row.clobTokenIds).map(String)
        const yesTokenId = tokenIds[0]?.trim()
        if (!yesTokenId) continue

        const result = await upsertMarket(row, new Date())
        if (result === "added") marketsAdded++
        else marketsUpdated++

        const mEndDate = parseDateOrNull(row.endDate ?? row.endDateIso)
        const mStartDate = parseDateOrNull(row.startDate ?? row.startDateIso ?? row.createdAt)
        upserted.push({ slug, yesTokenId, startDate: mStartDate, endDate: mEndDate })

        if (upserted.length % 50 === 0) {
          console.log(`  markets: ${upserted.length} upserted (${marketsAdded} new, ${marketsUpdated} updated)`)
        }
      }

      offset += batch.length
      if (batch.length < PAGE) break
    }

    console.log(`Phase 1 done: ${marketsAdded} added, ${marketsUpdated} updated`)
  }

  // Phase 2 — fetch candles for each market
  // Pre-load which markets already have candles so we skip needless CLOB fetches
  console.log(`Phase 2: checking existing candle coverage...`)
  const slugList = upserted.map((m) => m.slug)
  const candledRows = await sql`
    SELECT DISTINCT "marketSlug" FROM "PolymarketPriceCandle"
    WHERE "marketSlug" = ANY(${slugList})
  `
  const candledSlugs = new Set(candledRows.map((r) => r.marketSlug))
  console.log(`  ${candledSlugs.size}/${upserted.length} markets already have candles — skipping their CLOB fetches`)
  console.log(`Phase 2: fetching candles for ${upserted.length} markets...`)

  for (let i = 0; i < upserted.length; i++) {
    const m = upserted[i]
    try {
      const startTs = Math.floor((m.startDate ?? startDate).getTime() / 1000)
      const endTs = Math.floor((m.endDate ?? endDate).getTime() / 1000)
      if (endTs <= startTs) continue

      if (candledSlugs.has(m.slug)) {
        process.stdout.write(`  [${i+1}] ${m.slug} already candled — skip\r\n`)
        continue
      }

      process.stdout.write(`  [${i+1}] ${m.slug} fetching...\r\n`)
      const candles = await fetchCandles(m.yesTokenId, startTs, endTs)
      process.stdout.write(`  [${i+1}] ${m.slug} got ${candles.length} candles, inserting...\r\n`)
      const count = await upsertCandles(m.slug, candles)
      process.stdout.write(`  [${i+1}] ${m.slug} inserted ${count}\r\n`)
      candlesAdded += count

      if (DELAY_MS > 0) await sleep(DELAY_MS)

      try {
        await sql`UPDATE "PolymarketMarket" SET "lastSyncedAt" = ${new Date().toISOString()} WHERE slug = ${m.slug}`
      } catch { /* non-fatal */ }
    } catch (e) {
      console.warn(`  [warn] ${m.slug}: ${e.message || e} — skipping`)
    }

    if ((i + 1) % 20 === 0) {
      console.log(`  candles: ${i + 1}/${upserted.length} markets processed, ${candlesAdded} candles stored`)
    }
  }

  await completeSyncLog(logId, { marketsAdded, marketsUpdated, candlesAdded })
  console.log(`\nDone! syncLogId=${logId}`)
  console.log(`  Markets added:   ${marketsAdded}`)
  console.log(`  Markets updated: ${marketsUpdated}`)
  console.log(`  Candles stored:  ${candlesAdded}`)
}

process.on('uncaughtException', (e) => { console.error("Uncaught:", e.message || e); process.exitCode = 1; sql.end().finally(() => process.exit(1)) })
process.on('unhandledRejection', (e) => { console.error("UnhandledRejection:", e?.message || e); process.exitCode = 1; sql.end().finally(() => process.exit(1)) })

main()
  .catch((e) => { console.error("Fatal:", e.message || e); process.exitCode = 1 })
  .finally(() => sql.end())
