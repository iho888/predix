import type { FadeFavoriteParams, HighProbabilityBondParams } from "@/types"
import { addDays } from "date-fns"

export type GammaMarket = Record<string, unknown>

function parseJsonList(raw: unknown): unknown[] {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try {
      const d = JSON.parse(raw) as unknown
      return Array.isArray(d) ? d : []
    } catch {
      return []
    }
  }
  return []
}

function toFloat(x: unknown): number | null {
  if (x == null) return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}

function pickLeadingOutcome(
  outcomes: unknown[],
  prices: unknown[]
): { label: string; maxPrice: number; index: number } | null {
  let bestI: number | null = null
  let bestP: number | null = null
  for (let i = 0; i < prices.length; i++) {
    const pf = toFloat(prices[i])
    if (pf == null) continue
    if (bestP == null || pf > bestP) {
      bestP = pf
      bestI = i
    }
  }
  if (bestI == null || bestP == null) return null
  const label = bestI < outcomes.length && outcomes[bestI] != null ? String(outcomes[bestI]) : String(bestI)
  return { label, maxPrice: bestP, index: bestI }
}

function parseResolutionEndUtc(raw: string | null | undefined): Date | null {
  if (raw == null || !String(raw).trim()) return null
  let s = String(raw).trim()
  if (s.endsWith("Z")) s = s.slice(0, -1) + "+00:00"
  try {
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return null
    return dt
  } catch {
    return null
  }
}

/** Resolution must fall in `(now, now + days]` (see live bond scan). */
export function endsWithinDays(params: { endDate: string | null }, days: number, now: Date): boolean {
  const end = params.endDate ? parseResolutionEndUtc(params.endDate) : null
  if (!end) return false
  const windowEnd = addDays(now, days)
  return now.getTime() <= end.getTime() && end.getTime() <= windowEnd.getTime()
}

export interface LiveFilterEntry {
  marketId: string
  slug: string
  question: string
  urlPath: string
  leadingOutcome: string
  maxPrice: number
  edgeToPar: number
  liquidityNum: number | null
  volumeNum: number | null
  endDate: string | null
  active: boolean
  closed: boolean
}

function marketToEntry(market: GammaMarket): LiveFilterEntry | null {
  const outcomes = parseJsonList(market.outcomes)
  const prices = parseJsonList(market.outcomePrices)
  const tokens = parseJsonList(market.clobTokenIds)

  if (outcomes.length === 0 || prices.length === 0 || outcomes.length !== prices.length) return null

  const picked = pickLeadingOutcome(outcomes, prices)
  if (!picked) return null
  if (picked.index >= tokens.length) return null

  const slug = String(market.slug ?? "")
  const mid = market.id
  const marketId = mid != null ? String(mid) : slug
  const rawEnd = market.endDate ?? market.endDateIso
  const endS = rawEnd != null ? String(rawEnd) : null
  const liq = toFloat(market.liquidityNum)
  const vol = toFloat(market.volumeNum)
  const urlPath = slug ? `https://polymarket.com/market/${slug}` : ""

  return {
    marketId,
    slug,
    question: String(market.question ?? ""),
    urlPath,
    leadingOutcome: picked.label,
    maxPrice: Math.round(picked.maxPrice * 1e6) / 1e6,
    edgeToPar: Math.round((1.0 - picked.maxPrice) * 1e6) / 1e6,
    liquidityNum: liq,
    volumeNum: vol,
    endDate: endS,
    active: Boolean(market.active),
    closed: Boolean(market.closed),
  }
}

/**
 * Filter live Gamma markets using the same gates as a High-probability bond strategy’s scan parameters.
 * Ignores backtest-only fields (take profit, position size, etc.).
 */
export function filterMarketsByBondParams(
  markets: GammaMarket[],
  params: HighProbabilityBondParams,
  now: Date = new Date()
): LiveFilterEntry[] {
  const rows: LiveFilterEntry[] = []
  for (const m of markets) {
    const entry = marketToEntry(m)
    if (!entry) continue
    if (!entry.active || entry.closed) continue
    if (entry.maxPrice < params.minPrice) continue
    if (params.maxPrice != null && entry.maxPrice > params.maxPrice) continue
    if (entry.liquidityNum != null && entry.liquidityNum < params.minLiquidityNum) continue
    if (entry.volumeNum != null && entry.volumeNum < params.minVolumeNum) continue
    if (params.endWithinDays != null) {
      if (!endsWithinDays({ endDate: entry.endDate }, params.endWithinDays, now)) continue
    }
    rows.push(entry)
  }
  rows.sort((a, b) => {
    if (b.maxPrice !== a.maxPrice) return b.maxPrice - a.maxPrice
    return (b.liquidityNum ?? 0) - (a.liquidityNum ?? 0)
  })
  return rows
}

/**
 * Filter live Gamma markets for the Fade-the-Favorite strategy. Returns markets
 * where the YES side is currently in the leader band AND TTR is in the configured
 * range. Reuses the LiveFilterEntry shape but `leadingOutcome` is always reported
 * as YES (the side we're fading) and `edgeToPar` is `1 - yesPrice` (NO upside).
 */
export function filterMarketsByFadeParams(
  markets: GammaMarket[],
  params: FadeFavoriteParams,
  now: Date = new Date()
): LiveFilterEntry[] {
  const rows: LiveFilterEntry[] = []
  for (const m of markets) {
    if (!Boolean(m.active) || Boolean(m.closed)) continue
    if (m.neg_risk === true) continue
    const outcomes = parseJsonList(m.outcomes)
    const prices = parseJsonList(m.outcomePrices)
    const tokens = parseJsonList(m.clobTokenIds)
    if (outcomes.length !== 2 || prices.length !== 2 || tokens.length !== 2) continue

    const yesPrice = toFloat(prices[0])
    if (yesPrice == null) continue
    if (yesPrice < params.leaderMinPrice || yesPrice > params.leaderMaxPrice) continue

    const liq = toFloat(m.liquidityNum)
    const vol = toFloat(m.volumeNum)
    if (liq != null && liq < params.minLiquidityNum) continue
    if (vol != null && vol < params.minVolumeNum) continue

    const rawEnd = m.endDate ?? m.endDateIso
    const endS = rawEnd != null ? String(rawEnd) : null
    const end = parseResolutionEndUtc(endS)
    if (!end) continue
    const ttrDays = (end.getTime() - now.getTime()) / 86400000
    if (ttrDays < params.minTtrDays) continue
    if (params.maxTtrDays != null && ttrDays > params.maxTtrDays) continue

    const slug = String(m.slug ?? "")
    const mid = m.id
    rows.push({
      marketId: mid != null ? String(mid) : slug,
      slug,
      question: String(m.question ?? ""),
      urlPath: slug ? `https://polymarket.com/market/${slug}` : "",
      leadingOutcome: "YES",
      maxPrice: Math.round(yesPrice * 1e6) / 1e6,
      edgeToPar: Math.round((1 - yesPrice) * 1e6) / 1e6,
      liquidityNum: liq,
      volumeNum: vol,
      endDate: endS,
      active: true,
      closed: false,
    })
  }
  // Tightest YES-band markets first (closer to 0.50 = more uncertainty = higher EV)
  rows.sort((a, b) => Math.abs(a.maxPrice - 0.55) - Math.abs(b.maxPrice - 0.55))
  return rows
}

/**
 * Closed resolved markets only: same price / volume / liquidity gates as live bond scan,
 * but **requires** `closed === true`, ignores `active` / `accepting_orders`, and does **not**
 * apply `endWithinDays` (MVP — see simulations plan).
 */
export function filterClosedMarketsByBondParams(
  markets: GammaMarket[],
  params: HighProbabilityBondParams
): GammaMarket[] {
  const out: GammaMarket[] = []
  for (const m of markets) {
    if (!Boolean(m.closed)) continue
    const entry = marketToEntry(m)
    if (!entry) continue
    if (entry.maxPrice < params.minPrice) continue
    if (params.maxPrice != null && entry.maxPrice > params.maxPrice) continue
    if (entry.liquidityNum != null && entry.liquidityNum < params.minLiquidityNum) continue
    if (entry.volumeNum != null && entry.volumeNum < params.minVolumeNum) continue
    out.push(m)
  }
  out.sort((a, b) => {
    const ea = marketToEntry(a)
    const eb = marketToEntry(b)
    if (!ea || !eb) return 0
    if (eb.maxPrice !== ea.maxPrice) return eb.maxPrice - ea.maxPrice
    return (eb.liquidityNum ?? 0) - (ea.liquidityNum ?? 0)
  })
  return out
}
