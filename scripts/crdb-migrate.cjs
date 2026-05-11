"use strict"
const postgres = require("postgres")

const NEON = process.env.NEON_LEGACY_URL
const CRDB = process.env.CRDB_URL || process.env.DATABASE_URL
if (!NEON) { console.error("NEON_LEGACY_URL is required (set it in .env)"); process.exit(1) }
if (!CRDB) { console.error("CRDB_URL or DATABASE_URL is required (set it in .env)"); process.exit(1) }

const src = postgres(NEON, { ssl: "require", max: 3 })
const dst = postgres(CRDB, { ssl: "require", max: 5 })

// ── Step 1: Create schema ─────────────────────────────────────────────────────
async function createSchema() {
  console.log("Creating schema on CockroachDB...")
  await dst`
    CREATE TABLE IF NOT EXISTS "User" (
      id                   TEXT PRIMARY KEY,
      email                TEXT UNIQUE NOT NULL,
      name                 TEXT NOT NULL,
      "passwordHash"       TEXT NOT NULL,
      "createdAt"          TIMESTAMPTZ DEFAULT NOW(),
      "trialEndsAt"        TIMESTAMPTZ NOT NULL,
      "subscriptionStatus" TEXT DEFAULT 'TRIAL',
      "stripeCustomerId"   TEXT,
      "stripeSubscriptionId" TEXT
    )
  `
  await dst`
    CREATE TABLE IF NOT EXISTS "Strategy" (
      id            TEXT PRIMARY KEY,
      "userId"      TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      platform      TEXT NOT NULL,
      config        TEXT NOT NULL,
      "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"   TIMESTAMPTZ NOT NULL,
      "isActive"    BOOLEAN DEFAULT TRUE
    )
  `
  await dst`
    CREATE TABLE IF NOT EXISTS "Simulation" (
      id               TEXT PRIMARY KEY,
      "userId"         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "strategyId"     TEXT NOT NULL REFERENCES "Strategy"(id) ON DELETE CASCADE,
      name             TEXT NOT NULL,
      status           TEXT DEFAULT 'PENDING',
      "startDate"      TIMESTAMPTZ NOT NULL,
      "endDate"        TIMESTAMPTZ NOT NULL,
      "initialCapital" FLOAT8 DEFAULT 1000,
      platform         TEXT NOT NULL,
      "metricsJson"    TEXT,
      "tradesJson"     TEXT,
      "createdAt"      TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"      TIMESTAMPTZ NOT NULL
    )
  `
  await dst`
    CREATE TABLE IF NOT EXISTS "LiveApplyRun" (
      id               TEXT PRIMARY KEY,
      "userId"         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
      "strategyId"     TEXT NOT NULL REFERENCES "Strategy"(id) ON DELETE CASCADE,
      "paramsJson"     TEXT NOT NULL,
      "marketsScanned" INT NOT NULL,
      "matchCount"     INT NOT NULL,
      "matchesJson"    TEXT NOT NULL,
      "createdAt"      TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await dst`CREATE INDEX IF NOT EXISTS "LiveApplyRun_userId_createdAt_idx" ON "LiveApplyRun" ("userId", "createdAt" DESC)`
  await dst`CREATE INDEX IF NOT EXISTS "LiveApplyRun_strategyId_idx" ON "LiveApplyRun" ("strategyId")`
  await dst`
    CREATE TABLE IF NOT EXISTS "PolymarketMarket" (
      slug                  TEXT PRIMARY KEY,
      question              TEXT NOT NULL,
      "conditionId"         TEXT NOT NULL,
      "outcomesJson"        JSONB NOT NULL,
      "clobTokenIdsJson"    JSONB NOT NULL,
      closed                BOOLEAN DEFAULT FALSE,
      active                BOOLEAN DEFAULT FALSE,
      "negRisk"             BOOLEAN DEFAULT FALSE,
      "startDate"           TIMESTAMPTZ,
      "endDate"             TIMESTAMPTZ,
      "liquidityNum"        FLOAT8,
      "volumeNum"           FLOAT8,
      "winningOutcomeIndex" INT,
      "lastSyncedAt"        TIMESTAMPTZ,
      "createdAt"           TIMESTAMPTZ DEFAULT NOW(),
      "updatedAt"           TIMESTAMPTZ NOT NULL
    )
  `
  await dst`CREATE INDEX IF NOT EXISTS "PolymarketMarket_closed_idx"   ON "PolymarketMarket" (closed)`
  await dst`CREATE INDEX IF NOT EXISTS "PolymarketMarket_endDate_idx"  ON "PolymarketMarket" ("endDate")`
  await dst`CREATE INDEX IF NOT EXISTS "PolymarketMarket_active_idx"   ON "PolymarketMarket" (active)`
  await dst`
    CREATE TABLE IF NOT EXISTS "PolymarketPriceCandle" (
      "marketSlug" TEXT NOT NULL REFERENCES "PolymarketMarket"(slug) ON DELETE CASCADE,
      timestamp    TIMESTAMPTZ NOT NULL,
      "yesPrice"   FLOAT8 NOT NULL,
      PRIMARY KEY  ("marketSlug", timestamp)
    )
  `
  await dst`
    CREATE TABLE IF NOT EXISTS "DataSyncLog" (
      id               TEXT PRIMARY KEY,
      "startedAt"      TIMESTAMPTZ DEFAULT NOW(),
      "finishedAt"     TIMESTAMPTZ,
      "marketsAdded"   INT DEFAULT 0,
      "marketsUpdated" INT DEFAULT 0,
      "candlesAdded"   INT DEFAULT 0,
      status           TEXT NOT NULL,
      "errorMessage"   TEXT,
      "syncType"       TEXT NOT NULL
    )
  `
  console.log("Schema created.")
}

// ── Step 2: Copy small tables ─────────────────────────────────────────────────
async function copyTable(name, columns, rows) {
  if (rows.length === 0) { console.log(`  ${name}: 0 rows — skipped`); return }
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    await dst`INSERT INTO ${dst(name)} ${dst(batch, columns)} ON CONFLICT DO NOTHING`
  }
  console.log(`  ${name}: ${rows.length} rows copied`)
}

// ── Step 3: Copy candles in streaming batches ─────────────────────────────────
async function copyCandles() {
  const [{ total }] = await src`SELECT COUNT(*)::int AS total FROM "PolymarketPriceCandle"`
  console.log(`\nCopying candles: ${total.toLocaleString()} rows...`)

  const BATCH = 10_000
  let offset = 0
  let copied = 0
  const start = Date.now()

  while (offset < total) {
    const rows = await src`
      SELECT "marketSlug", timestamp, "yesPrice"
      FROM "PolymarketPriceCandle"
      ORDER BY "marketSlug", timestamp
      LIMIT ${BATCH} OFFSET ${offset}
    `
    if (rows.length === 0) break

    await dst`
      INSERT INTO "PolymarketPriceCandle" ${dst(rows, ["marketSlug", "timestamp", "yesPrice"])}
      ON CONFLICT DO NOTHING
    `
    copied += rows.length
    offset += rows.length

    const elapsed = ((Date.now() - start) / 1000).toFixed(0)
    const pct = ((copied / total) * 100).toFixed(1)
    process.stdout.write(`\r  ${copied.toLocaleString()} / ${total.toLocaleString()} (${pct}%) — ${elapsed}s elapsed   `)
  }
  console.log(`\n  Done: ${copied.toLocaleString()} candles copied`)
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await createSchema()

    console.log("\nCopying small tables...")

    const users = await src`SELECT id, email, name, "passwordHash", "createdAt", "trialEndsAt", "subscriptionStatus", "stripeCustomerId", "stripeSubscriptionId" FROM "User"`
    await copyTable("User", ["id","email","name","passwordHash","createdAt","trialEndsAt","subscriptionStatus","stripeCustomerId","stripeSubscriptionId"], users)

    const strategies = await src`SELECT id, "userId", name, description, platform, config, "createdAt", "updatedAt", "isActive" FROM "Strategy"`
    await copyTable("Strategy", ["id","userId","name","description","platform","config","createdAt","updatedAt","isActive"], strategies)

    const sims = await src`SELECT id, "userId", "strategyId", name, status, "startDate", "endDate", "initialCapital", platform, "metricsJson", "tradesJson", "createdAt", "updatedAt" FROM "Simulation"`
    await copyTable("Simulation", ["id","userId","strategyId","name","status","startDate","endDate","initialCapital","platform","metricsJson","tradesJson","createdAt","updatedAt"], sims)

    const lars = await src`SELECT id, "userId", "strategyId", "paramsJson", "marketsScanned", "matchCount", "matchesJson", "createdAt" FROM "LiveApplyRun"`
    await copyTable("LiveApplyRun", ["id","userId","strategyId","paramsJson","marketsScanned","matchCount","matchesJson","createdAt"], lars)

    const markets = await src`SELECT slug, question, "conditionId", "outcomesJson", "clobTokenIdsJson", closed, active, "negRisk", "startDate", "endDate", "liquidityNum", "volumeNum", "winningOutcomeIndex", "lastSyncedAt", "createdAt", "updatedAt" FROM "PolymarketMarket"`
    await copyTable("PolymarketMarket", ["slug","question","conditionId","outcomesJson","clobTokenIdsJson","closed","active","negRisk","startDate","endDate","liquidityNum","volumeNum","winningOutcomeIndex","lastSyncedAt","createdAt","updatedAt"], markets)

    const logs = await src`SELECT id, "startedAt", "finishedAt", "marketsAdded", "marketsUpdated", "candlesAdded", status, "errorMessage", "syncType" FROM "DataSyncLog"`
    await copyTable("DataSyncLog", ["id","startedAt","finishedAt","marketsAdded","marketsUpdated","candlesAdded","status","errorMessage","syncType"], logs)

    await copyCandles()

    // Verify
    const [cv] = await dst`SELECT COUNT(*)::int AS n FROM "PolymarketPriceCandle"`
    const [mv] = await dst`SELECT COUNT(*)::int AS n FROM "PolymarketMarket"`
    console.log(`\nVerification: ${mv.n} markets, ${cv.n.toLocaleString()} candles in CockroachDB`)
    console.log("Migration complete!")
  } finally {
    await src.end()
    await dst.end()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
