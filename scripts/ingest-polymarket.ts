import { prisma } from "@/lib/db"
import { ingestYesCandlesForMarket } from "@/lib/sync/ingest-candles"
import { ingestMarketsFromGamma } from "@/lib/sync/ingest-markets"

function parseLimitArg(argv: string[]): number | null {
  for (const a of argv) {
    const m = a.match(/^--limit=(\d+)$/)
    if (!m) continue
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return null
}

function pickYesTokenId(clobTokenIdsJson: unknown): string | null {
  if (!Array.isArray(clobTokenIdsJson)) return null
  const first = clobTokenIdsJson[0]
  const s = first != null ? String(first).trim() : ""
  return s ? s : null
}

async function main(): Promise<void> {
  const limit = parseLimitArg(process.argv.slice(2))
  const startedAt = new Date()

  const log = await prisma.dataSyncLog.create({
    data: {
      startedAt,
      status: "running",
      syncType: limit ? "manual" : "initial",
      marketsAdded: 0,
      marketsUpdated: 0,
      candlesAdded: 0,
    },
  })

  let marketsAdded = 0
  let marketsUpdated = 0
  let candlesAdded = 0

  try {
    const marketsRes = await ingestMarketsFromGamma({
      maxMarkets: limit ?? undefined,
      onProgress: ({ seen, added, updated }) => {
        // eslint-disable-next-line no-console
        console.log(`[markets] seen=${seen} added=${added} updated=${updated}`)
      },
    })

    marketsAdded = marketsRes.marketsAdded
    marketsUpdated = marketsRes.marketsUpdated

    let i = 0
    for (const slug of marketsRes.slugs) {
      i++
      const market = await prisma.polymarketMarket.findUnique({
        where: { slug },
        select: { slug: true, clobTokenIdsJson: true, startDate: true, endDate: true },
      })
      if (!market) continue

      const yesTokenId = pickYesTokenId(market.clobTokenIdsJson)
      if (!yesTokenId) continue

      const startTime = market.startDate ?? new Date("2019-01-01T00:00:00.000Z")
      const endTime = market.endDate ?? new Date()
      if (endTime.getTime() <= startTime.getTime()) continue

      const res = await ingestYesCandlesForMarket({
        marketSlug: market.slug,
        yesTokenId,
        startTime,
        endTime,
      })
      candlesAdded += res.candlesAdded

      if (i % 100 === 0) {
        // eslint-disable-next-line no-console
        console.log(`[candles] marketsProcessed=${i} candlesAdded=${candlesAdded}`)
      }
    }

    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        status: "completed",
        marketsAdded,
        marketsUpdated,
        candlesAdded,
      },
    })

    // eslint-disable-next-line no-console
    console.log(`Completed. marketsAdded=${marketsAdded} marketsUpdated=${marketsUpdated} candlesAdded=${candlesAdded}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        marketsAdded,
        marketsUpdated,
        candlesAdded,
        errorMessage: msg.slice(0, 5000),
      },
    })
    // eslint-disable-next-line no-console
    console.error(`Failed: ${msg}`)
    process.exitCode = 1
  }
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

