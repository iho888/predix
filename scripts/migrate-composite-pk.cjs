"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  console.log("Starting migration: remove id column, promote (marketSlug, timestamp) as PK")

  // 1. Check current state
  const [before] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`
  console.log(`DB size before: ${before.db_size}`)

  const [cnt] = await sql`SELECT COUNT(*) AS cnt FROM "PolymarketPriceCandle"`
  console.log(`Rows: ${cnt.cnt}`)

  // 2. Drop old primary key on id
  console.log("Dropping old primary key (id)...")
  await sql`ALTER TABLE "PolymarketPriceCandle" DROP CONSTRAINT "PolymarketPriceCandle_pkey"`
  console.log("  Done")

  // 3. Drop the id column (freed from the old PK constraint)
  console.log("Dropping id column...")
  await sql`ALTER TABLE "PolymarketPriceCandle" DROP COLUMN "id"`
  console.log("  Done")

  // 4. Promote existing unique index to primary key (no rebuild — reuses existing index)
  console.log("Promoting unique constraint to primary key (reuses existing index)...")
  await sql`ALTER TABLE "PolymarketPriceCandle" ADD CONSTRAINT "PolymarketPriceCandle_pkey" PRIMARY KEY USING INDEX "PolymarketPriceCandle_marketSlug_timestamp_key"`
  console.log("  Done")

  // 5. Check new state
  const [after] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`
  console.log(`DB size after: ${after.db_size}`)

  const idxs = await sql`
    SELECT i.relname, pg_size_pretty(pg_relation_size(i.oid)) AS sz, ix.indisprimary
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE t.relname = 'PolymarketPriceCandle'
    ORDER BY pg_relation_size(i.oid) DESC
  `
  console.log("Remaining indexes:")
  for (const idx of idxs) {
    console.log(`  ${idx.relname}: ${idx.sz} primary=${idx.indisprimary}`)
  }

  await sql.end()
}
main().catch(e => { console.error("Migration failed:", e.message); process.exit(1) })
