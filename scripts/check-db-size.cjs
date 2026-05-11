"use strict"
const postgres = require("postgres")
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) { console.error("DATABASE_URL is required (set it in .env)"); process.exit(1) }
const sql = postgres(DB_URL, { ssl: "require", max: 1 })

async function main() {
  // Table sizes
  const tables = await sql`
    SELECT relname AS table_name,
           pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
           pg_size_pretty(pg_relation_size(relid)) AS data_size,
           pg_size_pretty(pg_indexes_size(relid)) AS index_size,
           n_live_tup AS live_rows,
           n_dead_tup AS dead_rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 10
  `
  console.log("\n=== Table Sizes ===")
  for (const t of tables) {
    console.log(`${t.table_name}: total=${t.total_size} data=${t.data_size} idx=${t.index_size} live=${t.live_rows} dead=${t.dead_rows}`)
  }

  // Total DB size
  const [dbSize] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`
  console.log(`\nTotal DB size: ${dbSize.db_size}`)

  // Candle count
  const [cnt] = await sql`SELECT COUNT(*) AS cnt FROM "PolymarketPriceCandle"`
  console.log(`Candle rows: ${cnt.cnt}`)

  // Markets with candles
  const [mkt] = await sql`SELECT COUNT(DISTINCT "marketSlug") AS cnt FROM "PolymarketPriceCandle"`
  console.log(`Markets with candles: ${mkt.cnt}`)

  await sql.end()
}
main().catch(e => { console.error(e.message); process.exit(1) })
