import type { OrderBook, PricePoint } from "./types"

const DEFAULT_CLOB = "https://clob.polymarket.com"

function baseUrl(): string {
  return (process.env.CLOB_BASE_URL ?? DEFAULT_CLOB).replace(/\/+$/, "")
}

export type PriceHistoryInterval = "1m" | "1h" | "6h" | "1d" | "1w" | "max"

/**
 * Public CLOB price history. For resolved markets Polymarket often requires fidelity ≥ 720 (12h).
 * If the first call returns an empty series, retries with fidelity 60.
 */
export async function getPriceHistory(
  tokenId: string,
  interval: PriceHistoryInterval = "max",
  fidelity: number
): Promise<PricePoint[]> {
  const root = baseUrl()
  const tryFidelities = [fidelity, 720, 60].filter((n, i, a) => Number.isFinite(n) && n > 0 && a.indexOf(n) === i)

  for (const f of tryFidelities) {
    const params = new URLSearchParams()
    params.set("market", tokenId)
    params.set("interval", interval)
    params.set("fidelity", String(Math.round(f)))

    const res = await fetch(`${root}/prices-history?${params}`, { cache: "no-store" })
    if (!res.ok) continue
    const data: unknown = await res.json()
    if (!data || typeof data !== "object" || !("history" in data)) continue
    const hist = (data as { history: unknown }).history
    if (!Array.isArray(hist) || hist.length === 0) continue

    const points: PricePoint[] = []
    for (const row of hist) {
      if (!row || typeof row !== "object") continue
      const r = row as { t?: unknown; p?: unknown }
      const t = Number(r.t)
      const p = Number(r.p)
      if (!Number.isFinite(t) || !Number.isFinite(p)) continue
      points.push({ t, p })
    }
    if (points.length > 0) {
      points.sort((a, b) => a.t - b.t)
      return points
    }
  }

  return []
}

/** Minimal book stub when not fetching the book (simulation MVP). */
export function emptyOrderBook(midpoint: number): OrderBook {
  return {
    bids: [],
    asks: [],
    midpoint,
    spread: 0,
  }
}
