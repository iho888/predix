// Usage: npx tsx scripts/fetch-historic-data.ts --start 2024-01-01 --end 2024-06-30 [--max 500]
import { prisma } from "@/lib/db"
import { fetchHistoricRange } from "@/lib/sync/fetch-historic-range"

function parseArgs(argv: string[]): { startDate: Date; endDate: Date; maxMarkets: number } {
  let start: string | null = null
  let end: string | null = null
  let max = 500

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--start" && argv[i + 1]) start = argv[++i]
    else if (argv[i] === "--end" && argv[i + 1]) end = argv[++i]
    else if (argv[i] === "--max" && argv[i + 1]) {
      const n = parseInt(argv[++i], 10)
      if (Number.isFinite(n) && n > 0) max = n
    }
  }

  if (!start || !end) {
    console.error("Usage: fetch-historic-data.ts --start YYYY-MM-DD --end YYYY-MM-DD [--max N]")
    process.exit(1)
  }

  const startDate = new Date(start + "T00:00:00Z")
  const endDate = new Date(end + "T23:59:59Z")

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    console.error("Invalid date format. Use YYYY-MM-DD.")
    process.exit(1)
  }

  if (startDate >= endDate) {
    console.error("--start must be before --end.")
    process.exit(1)
  }

  return { startDate, endDate, maxMarkets: max }
}

async function main(): Promise<void> {
  const { startDate, endDate, maxMarkets } = parseArgs(process.argv.slice(2))

  // eslint-disable-next-line no-console
  console.log(`Fetching historic Polymarket data: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (max ${maxMarkets} markets)`)

  const result = await fetchHistoricRange({
    startDate,
    endDate,
    maxMarkets,
    syncType: "historic-cli",
    // eslint-disable-next-line no-console
    onProgress: (msg) => console.log(`[progress] ${msg}`),
  })

  // eslint-disable-next-line no-console
  console.log(
    `Completed. syncLogId=${result.syncLogId} marketsAdded=${result.marketsAdded} marketsUpdated=${result.marketsUpdated} candlesAdded=${result.candlesAdded} marketsProcessed=${result.marketsProcessed}`
  )
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
