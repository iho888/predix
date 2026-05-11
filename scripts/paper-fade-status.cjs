// scripts/paper-fade-status.cjs
// Daily status check for paper-fade positions. Shows OPEN positions, aggregate
// stats on closed ones, and per-day signal flow. Run after the daily cron fires.
"use strict"
const postgres = require("postgres")
const fs = require("fs")

// Load .env manually — Node's --env-file flag chokes on UTF-8 BOM that
// PowerShell `Set-Content -Encoding utf8` writes.
function loadDotenv(path) {
  if (!fs.existsSync(path)) return
  const raw = fs.readFileSync(path, "utf8").replace(/^﻿/, "")
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    const key = m[1]
    let val = m[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === "") process.env[key] = val
  }
}
loadDotenv(".env")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL required (not in .env or env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

;(async () => {
  // Status summary
  const status = await sql`
    SELECT status, COUNT(*)::int AS n,
           ROUND(AVG("positionSizeUsd")::numeric, 2)::float AS avg_size
    FROM "PaperPosition"
    GROUP BY status
    ORDER BY status`
  console.log("=== Status summary ===")
  console.table(status)

  // Closed positions aggregate
  const closed = await sql`
    SELECT
      COUNT(*)::int AS n,
      COUNT(*) FILTER (WHERE "pnlUsd" > 0)::int AS wins,
      COUNT(*) FILTER (WHERE "pnlUsd" <= 0)::int AS losses,
      ROUND(AVG("pnlUsd")::numeric, 2)::float AS avg_pnl,
      ROUND(SUM("pnlUsd")::numeric, 2)::float AS total_pnl,
      ROUND(MIN("pnlUsd")::numeric, 2)::float AS worst,
      ROUND(MAX("pnlUsd")::numeric, 2)::float AS best
    FROM "PaperPosition"
    WHERE status IN ('CLOSED','RESOLVED')`
  console.log("\n=== Closed/resolved aggregate ===")
  if (closed[0].n > 0) {
    const winRate = (closed[0].wins / closed[0].n * 100).toFixed(1)
    console.log(`  n=${closed[0].n}, win rate=${winRate}%, total PnL=$${closed[0].total_pnl}, avg=$${closed[0].avg_pnl}`)
    console.log(`  range: worst=$${closed[0].worst}, best=$${closed[0].best}`)
  } else {
    console.log("  none yet — first exit at entry+14d")
  }

  // Open positions
  const open = await sql`
    SELECT "marketSlug", "entryMid", "entryFillPrice", "positionSizeUsd",
           "endDate", "entryTime"
    FROM "PaperPosition"
    WHERE status = 'OPEN'
    ORDER BY "entryTime" DESC`
  console.log(`\n=== Open positions (${open.length}) ===`)
  console.table(open.map(p => ({
    slug: p.marketSlug.length > 50 ? p.marketSlug.slice(0, 47) + "..." : p.marketSlug,
    entry: Number(p.entryMid).toFixed(3),
    fill: Number(p.entryFillPrice).toFixed(3),
    size: "$" + Number(p.positionSizeUsd).toFixed(0),
    entered: p.entryTime.toISOString().slice(0, 10),
    resolves: p.endDate.toISOString().slice(0, 10),
    ageDays: Math.floor((Date.now() - p.entryTime.getTime()) / 86400000),
  })))

  // Signal flow per day (recently)
  const flow = await sql`
    SELECT TO_CHAR(DATE_TRUNC('day', "entryTime"), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS opened
    FROM "PaperPosition"
    WHERE "entryTime" > NOW() - INTERVAL '14 days'
    GROUP BY 1
    ORDER BY 1 DESC`
  console.log("\n=== Daily entries (last 14d) ===")
  console.table(flow)

  await sql.end()
})().catch(e => { console.error(e.message); process.exit(1) })
