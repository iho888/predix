// One-shot DDL migration for PaperPosition table. Bypasses Prisma schema engine
// because of B-0002 (Prisma 5.16 native engine segfaults on Node 24 Windows).
"use strict"
const postgres = require("postgres")

const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

;(async () => {
  console.log("Creating PaperPosition table…")
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS "PaperPosition" (
      id              STRING NOT NULL,
      "userId"        STRING NOT NULL,
      "strategyId"    STRING NOT NULL,
      "marketSlug"    STRING NOT NULL,
      "marketQuestion" STRING NOT NULL,
      side            STRING NOT NULL,
      "tokenId"       STRING NOT NULL,
      "endDate"       TIMESTAMP(3) NOT NULL,
      "entryTime"     TIMESTAMP(3) NOT NULL,
      "entryMid"      DOUBLE PRECISION NOT NULL,
      "entryFillPrice" DOUBLE PRECISION NOT NULL,
      "positionSizeUsd" DOUBLE PRECISION NOT NULL,
      shares          DOUBLE PRECISION NOT NULL,
      status          STRING NOT NULL DEFAULT 'OPEN',
      "exitTime"      TIMESTAMP(3),
      "exitMid"       DOUBLE PRECISION,
      "exitFillPrice" DOUBLE PRECISION,
      "exitReason"    STRING,
      "pnlUsd"        DOUBLE PRECISION,
      "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP(3) NOT NULL,
      CONSTRAINT "PaperPosition_pkey" PRIMARY KEY (id),
      CONSTRAINT "PaperPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE,
      CONSTRAINT "PaperPosition_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"(id) ON DELETE CASCADE
    )
  `)
  console.log("  table created (or already exists)")

  console.log("Creating indexes…")
  await sql.unsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PaperPosition_strategyId_marketSlug_status_key"
      ON "PaperPosition" ("strategyId", "marketSlug", status)
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS "PaperPosition_userId_status_idx"
      ON "PaperPosition" ("userId", status)
  `)
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS "PaperPosition_status_entryTime_idx"
      ON "PaperPosition" (status, "entryTime")
  `)
  console.log("  indexes created (or already existed)")

  // Verify
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM "PaperPosition"`
  console.log(`PaperPosition row count: ${count}`)

  await sql.end()
})().catch(e => { console.error("FAIL", e.message); process.exit(1) })
