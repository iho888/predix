import type { MarketTick, Platform } from "@/types"
import { fromUnixTime } from "date-fns"

const GAMMA_BASE = "https://gamma-api.polymarket.com"
const CLOB_BASE = "https://clob.polymarket.com"

interface GammaHistoricalMarket {
  id?: string
  question?: string
  slug?: string
  clobTokenIds?: string | string[]
  endDate?: string
  liquidityNum?: number
  volumeNum?: number
}

interface ClobPricePoint {
  t: number
  p: number
}

function parseJsonField(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as string[] } catch { return [] }
  }
  return []
}

async function fetchHistoricalGammaMarkets(
  startDate: Date,
  endDate: Date,
  maxMarkets: number
): Promise<GammaHistoricalMarket[]> {
  const sixMonthsAfter = new Date(endDate.getTime() + 180 * 24 * 60 * 60 * 1000)

  const params = new URLSearchParams({
    closed: "true",
    limit: "100",
    offset: "0",
    order: "volumeNum",
    ascending: "false",
  })

  const res = await fetch(`${GAMMA_BASE}/markets?${params.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  })
  if (!res.ok) return []

  const data = await res.json() as unknown
  if (!Array.isArray(data)) return []

  const markets = data as GammaHistoricalMarket[]

  // Keep markets whose resolution date falls within [startDate, startDate+6mo]
  return markets
    .filter((m) => {
      if (!m.endDate) return false
      const endDt = new Date(m.endDate)
      return endDt >= startDate && endDt <= sixMonthsAfter
    })
    .slice(0, maxMarkets)
}

async function fetchClobPriceHistory(
  tokenId: string,
  startTs: number,
  endTs: number
): Promise<ClobPricePoint[]> {
  const params = new URLSearchParams({
    market: tokenId,
    startTs: String(startTs),
    endTs: String(endTs),
    fidelity: "60",
  })

  const res = await fetch(`${CLOB_BASE}/prices-history?${params.toString()}`, {
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  })
  if (!res.ok) return []

  const data = await res.json() as { history?: ClobPricePoint[] }
  return Array.isArray(data.history) ? data.history : []
}

export async function fetchRealPolymarketTicks(
  startDate: Date,
  endDate: Date,
  maxMarkets = 8
): Promise<MarketTick[]> {
  const markets = await fetchHistoricalGammaMarkets(startDate, endDate, maxMarkets)
  if (markets.length === 0) return []

  const startTs = Math.floor(startDate.getTime() / 1000)
  const endTs = Math.floor(endDate.getTime() / 1000)
  const allTicks: MarketTick[] = []

  await Promise.allSettled(
    markets.map(async (market) => {
      const tokenIds = parseJsonField(market.clobTokenIds)
      if (tokenIds.length === 0) return

      const history = await fetchClobPriceHistory(tokenIds[0], startTs, endTs)
      if (history.length < 2) return

      const marketId = `poly_real_${market.id ?? market.slug ?? Math.random()}`
      const liq = typeof market.liquidityNum === "number" ? market.liquidityNum : 10_000
      const vol = typeof market.volumeNum === "number" ? market.volumeNum : 50_000
      const resolveDate = market.endDate ? new Date(market.endDate) : endDate

      for (let i = 0; i < history.length; i++) {
        const point = history[i]
        const prev = i > 0 ? history[i - 1] : point
        const yesPrice = Math.max(0.01, Math.min(0.99, point.p))
        const prevPrice = Math.max(0.01, Math.min(0.99, prev.p))

        const delta = yesPrice - prevPrice
        const trend: "rising" | "falling" | "stable" =
          delta > 0.005 ? "rising" : delta < -0.005 ? "falling" : "stable"

        allTicks.push({
          marketId,
          title: market.question ?? "Unknown market",
          timestamp: fromUnixTime(point.t),
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
    })
  )

  return allTicks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
