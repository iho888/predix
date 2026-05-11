// Seed a fade_favorite strategy for the first user (or a specified email).
// Idempotent — won't create duplicates.
"use strict"
const postgres = require("postgres")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

const TARGET_EMAIL = process.argv[2] || null

const fadeParams = {
  leaderMinPrice: 0.50,
  leaderMaxPrice: 0.60,
  minTtrDays: 120,
  maxTtrDays: null,
  minLiquidityNum: 1000,
  minVolumeNum: 25000,
  takeProfitPct: null,
  stopLossPct: null,
  maxHoldingDays: 14,
  slippagePerLegPct: 0.06,
  positionSizePct: 2,
  maxOpenPositions: 20,
}
const config = {
  templateId: "fade_favorite",
  version: 1,
  params: fadeParams,
}

;(async () => {
  let user
  if (TARGET_EMAIL) {
    const rows = await sql`SELECT id, email FROM "User" WHERE email = ${TARGET_EMAIL} LIMIT 1`
    user = rows[0]
  } else {
    const rows = await sql`SELECT id, email FROM "User" ORDER BY "createdAt" ASC LIMIT 1`
    user = rows[0]
  }
  if (!user) { console.error("No user found"); process.exit(1) }
  console.log(`Target user: ${user.email} (${user.id})`)

  const existing = await sql`
    SELECT id, name FROM "Strategy"
    WHERE "userId" = ${user.id} AND "isActive" = true AND config LIKE '%fade_favorite%'
    LIMIT 1`
  if (existing.length > 0) {
    console.log(`  fade_favorite strategy already exists: ${existing[0].id} (${existing[0].name})`)
    await sql.end()
    return
  }

  const id = "strat_" + Math.random().toString(36).slice(2, 12)
  const now = new Date().toISOString()
  await sql`
    INSERT INTO "Strategy" (id, "userId", name, description, platform, config, "createdAt", "updatedAt", "isActive")
    VALUES (
      ${id}, ${user.id},
      'Fade-the-Favorite v10',
      'Calibrated 2026-05: bet NO when YES ∈ [0.50, 0.60] with TTR ≥ 120d. 14d hold, 6% slippage modeled, vol ≥ 25k. Bench: 65% annualized post-slippage, 9% maxDD, Sharpe 3.95.',
      'polymarket',
      ${JSON.stringify(config)},
      ${now}, ${now}, true
    )`
  console.log(`  created strategy ${id}`)

  await sql.end()
})().catch(e => { console.error("FAIL", e.message); process.exit(1) })
