import { prisma } from "@/lib/db"
import type { MarketTick, Platform } from "@/types"

/**
 * Fetches MarketTick[] from stored PolymarketPriceCandle rows.
 * Returns an empty array if the DB has no candles for the given window.
 */
export async function fetchDbPolymarketTicks(
  startDate: Date,
  endDate: Date,
  maxMarkets = 50
): Promise<MarketTick[]> {
  const markets = await prisma.polymarketMarket.findMany({
    where: {
      closed: true,
      endDate: { gte: startDate, lte: endDate },
      winningOutcomeIndex: { not: null },
    },
    orderBy: { volumeNum: "desc" },
    take: maxMarkets,
    select: {
      slug: true,
      question: true,
      liquidityNum: true,
      volumeNum: true,
      endDate: true,
    },
  })

  if (markets.length === 0) return []

  const slugs = markets.map((m) => m.slug)
  const candles = await prisma.polymarketPriceCandle.findMany({
    where: {
      marketSlug: { in: slugs },
      timestamp: { gte: startDate, lte: endDate },
    },
    orderBy: { timestamp: "asc" },
    select: { marketSlug: true, timestamp: true, yesPrice: true },
  })

  if (candles.length === 0) return []

  const marketMap = new Map(markets.map((m) => [m.slug, m]))

  // Group candles by market slug
  const bySlug = new Map<string, { timestamp: Date; yesPrice: number }[]>()
  for (const c of candles) {
    const list = bySlug.get(c.marketSlug)
    if (list) list.push(c)
    else bySlug.set(c.marketSlug, [c])
  }

  const allTicks: MarketTick[] = []

  for (const [slug, rows] of bySlug) {
    const market = marketMap.get(slug)
    if (!market) continue

    const liq = market.liquidityNum ?? 10_000
    const vol = market.volumeNum ?? 50_000
    const resolveDate = market.endDate ?? endDate

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!
      const prev = i > 0 ? rows[i - 1]! : row
      const yesPrice = Math.max(0.01, Math.min(0.99, row.yesPrice))
      const prevPrice = Math.max(0.01, Math.min(0.99, prev.yesPrice))

      const delta = yesPrice - prevPrice
      const trend: "rising" | "falling" | "stable" =
        delta > 0.005 ? "rising" : delta < -0.005 ? "falling" : "stable"

      allTicks.push({
        marketId: `poly_db_${slug}`,
        title: market.question,
        timestamp: row.timestamp,
        yesPrice,
        noPrice: 1 - yesPrice,
        volume24h: Math.round(vol * 0.15),
        totalVolume: Math.round(vol),
        liquidity: Math.round(liq),
        trend,
        platform: "polymarket" as Platform,
        resolveDate,
      })
    }
  }

  return allTicks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
