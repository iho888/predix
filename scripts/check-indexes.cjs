"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  const indexes = await sql`
    SELECT i.relname AS index_name,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary,
           pg_size_pretty(pg_relation_size(i.oid)) AS index_size,
           array_to_string(array_agg(a.attname ORDER BY k.n), ', ') AS columns
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid
    JOIN unnest(ix.indkey) WITH ORDINALITY k(attnum, n) ON a.attnum = k.attnum
    WHERE t.relname = 'PolymarketPriceCandle'
    GROUP BY i.relname, ix.indisunique, ix.indisprimary, i.oid
    ORDER BY pg_relation_size(i.oid) DESC
  `
  console.log("Indexes on PolymarketPriceCandle:")
  for (const idx of indexes) {
    console.log(`  ${idx.index_name}: size=${idx.index_size} unique=${idx.is_unique} primary=${idx.is_primary} cols=[${idx.columns}]`)
  }

  // Also check if timestamp column is actually a timestamp type
  const cols = await sql`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'PolymarketPriceCandle'
    ORDER BY ordinal_position
  `
  console.log("\nColumn types:")
  for (const c of cols) {
    console.log(`  ${c.column_name}: ${c.data_type}${c.character_maximum_length ? '('+c.character_maximum_length+')' : ''}`)
  }
  await sql.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
