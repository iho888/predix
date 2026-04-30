import type { GammaMarket } from "@/lib/gamma/watchlist-filter"

const DEFAULT_GAMMA = "https://gamma-api.polymarket.com"

function gammaRoot(): string {
  return (process.env.GAMMA_BASE_URL ?? DEFAULT_GAMMA).replace(/\/+$/, "")
}

function parseMarketEndUtc(row: Record<string, unknown>): Date | null {
  const raw = row.endDate ?? row.endDateIso
  if (raw == null || !String(raw).trim()) return null
  let s = String(raw).trim()
  if (s.endsWith("Z")) s = s.slice(0, -1) + "+00:00"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseMarketStartUtc(row: Record<string, unknown>): Date | null {
  const raw = row.startDate ?? row.startDateIso ?? row.createdAt
  if (raw == null || !String(raw).trim()) return null
  let s = String(raw).trim()
  if (s.endsWith("Z")) s = s.slice(0, -1) + "+00:00"
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Resolution timestamp in `[simStart, simEnd]` (inclusive). */
export function marketResolutionInWindow(row: Record<string, unknown>, simStart: Date, simEnd: Date): boolean {
  const end = parseMarketEndUtc(row)
  if (!end) return false
  return end.getTime() >= simStart.getTime() && end.getTime() <= simEnd.getTime()
}

/**
 * Market existed on `simStart` if Gamma lists a start on/before sim start.
 * If start is missing, we include the row (API limitation — same as plan disclaimer).
 */
export function marketExistedOnOrBeforeSimStart(row: Record<string, unknown>, simStart: Date): boolean {
  const s = parseMarketStartUtc(row)
  if (!s) return true
  return s.getTime() <= simStart.getTime()
}

/**
 * Paginated closed markets, then client-filtered to resolutions in `[simStart, simEnd]`
 * that existed on or before `simStart`. Tries `end_date_min` / `end_date_max` when supported;
 * falls back to broader fetch + client filter.
 */
export async function fetchHistoricalResolvedMarkets(options: {
  simStart: Date
  simEnd: Date
  maxMarkets: number
  pageSize?: number
}): Promise<GammaMarket[]> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50))
  const cap = Math.min(100, Math.max(1, Math.floor(options.maxMarkets)))
  const { simStart, simEnd } = options
  const root = gammaRoot()

  const collected: GammaMarket[] = []
  const seen = new Set<string>()
  let offset = 0

  for (let page = 0; page < 30 && collected.length < cap; page++) {
    const params = new URLSearchParams()
    params.set("closed", "true")
    params.set("limit", String(pageSize))
    params.set("offset", String(offset))
    params.set("order", "end_date")
    params.set("ascending", "false")
    params.set("end_date_min", simStart.toISOString().slice(0, 10))
    params.set("end_date_max", simEnd.toISOString().slice(0, 10))

    let res = await fetch(`${root}/markets?${params}`, { cache: "no-store" })
    if (!res.ok) {
      params.delete("end_date_min")
      params.delete("end_date_max")
      res = await fetch(`${root}/markets?${params}`, { cache: "no-store" })
    }
    if (!res.ok) break

    const batch: unknown = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break

    for (const item of batch) {
      if (!item || typeof item !== "object") continue
      const row = item as Record<string, unknown>
      if (!marketResolutionInWindow(row, simStart, simEnd)) continue
      if (!marketExistedOnOrBeforeSimStart(row, simStart)) continue
      const slug = String(row.slug ?? "")
      if (!slug || seen.has(slug)) continue
      seen.add(slug)
      collected.push(row as GammaMarket)
      if (collected.length >= cap) break
    }

    offset += batch.length
    if (batch.length < pageSize) break
  }

  return collected.slice(0, cap)
}
