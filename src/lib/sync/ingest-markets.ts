import { prisma } from "@/lib/db"

const DEFAULT_GAMMA = "https://gamma-api.polymarket.com"

function gammaBaseUrl(): string {
  return (process.env.GAMMA_BASE_URL ?? DEFAULT_GAMMA).replace(/\/+$/, "")
}

function parseJsonArray(raw: unknown): unknown[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw) as unknown
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  return []
}

function toNumOrNull(x: unknown): number | null {
  if (x == null) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function parseDateOrNull(raw: unknown): Date | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  const dt = new Date(s)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function inferWinningOutcomeIndexFromPrices(prices: unknown[]): 0 | 1 | null {
  if (prices.length < 2) return null
  const p0 = Number(prices[0])
  const p1 = Number(prices[1])
  if (!Number.isFinite(p0) || !Number.isFinite(p1)) return null
  if (p0 >= 0.99) return 0
  if (p1 >= 0.99) return 1
  return null
}

export type IngestMarketsResult = {
  marketsAdded: number
  marketsUpdated: number
  slugs: string[]
}

export type GammaMarketRow = Record<string, unknown>

export async function fetchGammaMarketsPage(params: { limit: number; offset: number }): Promise<GammaMarketRow[]> {
  const root = gammaBaseUrl()
  const p = new URLSearchParams()
  p.set("limit", String(Math.min(200, Math.max(1, Math.floor(params.limit)))))
  p.set("offset", String(Math.max(0, Math.floor(params.offset))))

  const res = await fetch(`${root}/markets?${p}`, { cache: "no-store" })
  if (!res.ok) return []
  const data: unknown = await res.json()
  if (!Array.isArray(data)) return []
  return data.filter((x): x is GammaMarketRow => !!x && typeof x === "object")
}

export function isBinaryNonNegRiskMarket(row: GammaMarketRow): boolean {
  if (row.neg_risk === true) return false
  const outcomes = parseJsonArray(row.outcomes)
  const tokenIds = parseJsonArray(row.clobTokenIds)
  return outcomes.length === 2 && tokenIds.length === 2
}

export async function ingestMarketsFromGamma(options: {
  pageLimit?: number
  maxMarkets?: number
  onProgress?: (stats: { seen: number; added: number; updated: number; lastSlug?: string }) => void
}): Promise<IngestMarketsResult> {
  const pageLimit = options.pageLimit ?? Number(process.env.GAMMA_PAGE_LIMIT ?? 100)
  const maxMarkets = options.maxMarkets ?? Number(process.env.MAX_MARKETS_INITIAL_INGEST ?? 100000)
  const hardCap = Number.isFinite(maxMarkets) ? Math.max(1, Math.floor(maxMarkets)) : 100000

  let offset = 0
  let seen = 0
  let added = 0
  let updated = 0
  const slugs: string[] = []

  while (seen < hardCap) {
    const batch = await fetchGammaMarketsPage({ limit: pageLimit, offset })
    if (batch.length === 0) break
    offset += batch.length

    for (const row of batch) {
      if (seen >= hardCap) break
      seen++
      if (!isBinaryNonNegRiskMarket(row)) continue

      const slug = String(row.slug ?? "").trim()
      if (!slug) continue

      const outcomes = parseJsonArray(row.outcomes).map((o) => String(o))
      const tokenIds = parseJsonArray(row.clobTokenIds).map((o) => String(o))
      if (outcomes.length !== 2 || tokenIds.length !== 2) continue

      const closed = Boolean(row.closed)
      const outcomePrices = parseJsonArray(row.outcomePrices)
      const winningOutcomeIndex = closed ? inferWinningOutcomeIndexFromPrices(outcomePrices) : null

      const now = new Date()
      const data = {
        slug,
        question: String(row.question ?? ""),
        conditionId: String(row.conditionId ?? ""),
        outcomesJson: outcomes,
        clobTokenIdsJson: tokenIds,
        closed,
        active: Boolean(row.active),
        negRisk: Boolean(row.neg_risk),
        startDate: parseDateOrNull(row.startDate),
        endDate: parseDateOrNull(row.endDate ?? row.endDateIso),
        liquidityNum: toNumOrNull(row.liquidityNum),
        volumeNum: toNumOrNull(row.volumeNum),
        winningOutcomeIndex,
        lastSyncedAt: now,
      }

      try {
        await prisma.polymarketMarket.create({ data })
        added++
        slugs.push(slug)
      } catch {
        await prisma.polymarketMarket.update({ where: { slug }, data })
        updated++
        slugs.push(slug)
      }

      if (options.onProgress && seen % 100 === 0) {
        options.onProgress({ seen, added, updated, lastSlug: slug })
      }
    }
  }

  return { marketsAdded: added, marketsUpdated: updated, slugs }
}

