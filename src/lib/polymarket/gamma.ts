import type { SimulationMarket } from "./types"

const DEFAULT_GAMMA = "https://gamma-api.polymarket.com"

function baseUrl(): string {
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

function toNum(x: unknown): number {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Pick winning binary index from post-resolution prices (~1 / ~0). */
function binaryWinnerIndex(prices: [number, number]): 0 | 1 | null {
  const [a, b] = prices
  if (a >= 0.99 && b <= 0.02) return 0
  if (b >= 0.99 && a <= 0.02) return 1
  if (a > b && a >= 0.99) return 0
  if (b > a && b >= 0.99) return 1
  return null
}

function rawToSimulationMarket(row: Record<string, unknown>): SimulationMarket | null {
  const outcomes = parseJsonArray(row.outcomes).map((o) => String(o))
  const tokenIds = parseJsonArray(row.clobTokenIds).map((o) => String(o))
  const priceRaw = parseJsonArray(row.outcomePrices).map(toNum)

  if (outcomes.length !== 2 || tokenIds.length !== 2 || priceRaw.length !== 2) return null

  const closed = Boolean(row.closed)
  const slug = String(row.slug ?? "")
  if (!slug) return null

  const prices: [number, number] = [priceRaw[0], priceRaw[1]]
  const winningOutcomeIndex = closed ? binaryWinnerIndex(prices) : null

  return {
    slug,
    question: String(row.question ?? ""),
    conditionId: String(row.conditionId ?? ""),
    closed,
    outcomes: [outcomes[0], outcomes[1]],
    clobTokenIds: [tokenIds[0], tokenIds[1]],
    outcomePrices: prices,
    winningOutcomeIndex,
  }
}

export async function getMarketBySlug(slug: string): Promise<SimulationMarket | null> {
  const root = baseUrl()
  const trimmed = slug.trim().replace(/^\/+/, "")
  const urls = [`${root}/markets/slug/${encodeURIComponent(trimmed)}`, `${root}/markets?slug=${encodeURIComponent(trimmed)}&limit=1`]

  for (const url of urls) {
    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) continue
    const data: unknown = await res.json()
    if (Array.isArray(data)) {
      const first = data[0]
      if (first && typeof first === "object") {
        const m = rawToSimulationMarket(first as Record<string, unknown>)
        if (m) return m
      }
      continue
    }
    if (data && typeof data === "object") {
      const m = rawToSimulationMarket(data as Record<string, unknown>)
      if (m) return m
    }
  }
  return null
}

export type ClosedMarketSearchHit = Pick<SimulationMarket, "slug" | "question" | "closed">

export async function searchClosedMarkets(query: string, limit = 15): Promise<ClosedMarketSearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const root = baseUrl()
  const params = new URLSearchParams()
  params.set("closed", "true")
  params.set("limit", String(Math.min(50, Math.max(1, limit))))
  params.set("q", q)

  const res = await fetch(`${root}/markets?${params}`, { cache: "no-store" })
  if (!res.ok) return []
  const batch: unknown = await res.json()
  if (!Array.isArray(batch)) return []

  const out: ClosedMarketSearchHit[] = []
  for (const item of batch) {
    if (!item || typeof item !== "object") continue
    const m = rawToSimulationMarket(item as Record<string, unknown>)
    if (m?.closed) {
      out.push({ slug: m.slug, question: m.question, closed: m.closed })
      if (out.length >= limit) break
    }
  }
  return out
}
