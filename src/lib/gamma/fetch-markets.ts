import type { GammaMarket } from "./watchlist-filter"

const MAX_RETRIES = 4
const RETRY_BACKOFF_MS = 2000

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export type FetchMarketsOptions = {
  baseUrl: string
  pageLimit: number
  maxMarkets: number | null
  liquidityNumMin: number | null
  volumeNumMin: number | null
  signal?: AbortSignal
}

/**
 * Paginate GET /markets (Gamma) until a short page or cap.
 */
export async function fetchAllMarkets(opts: FetchMarketsOptions): Promise<GammaMarket[]> {
  const {
    baseUrl,
    pageLimit,
    maxMarkets,
    liquidityNumMin,
    volumeNumMin,
    signal,
  } = opts
  const markets: GammaMarket[] = []
  let offset = 0
  const path = "/markets"
  const root = baseUrl.replace(/\/+$/, "")

  while (true) {
    const params = new URLSearchParams()
    params.set("limit", String(pageLimit))
    params.set("offset", String(offset))
    params.set("closed", "false")
    if (liquidityNumMin != null) params.set("liquidity_num_min", String(liquidityNumMin))
    if (volumeNumMin != null) params.set("volume_num_min", String(volumeNumMin))

    const url = `${root}${path}?${params.toString()}`

    let batch: unknown = null
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error("Aborted")
      const res = await fetch(url, { signal, cache: "no-store" })
      if (res.ok) {
        batch = await res.json()
        break
      }
      if (attempt + 1 >= MAX_RETRIES) {
        const text = await res.text()
        throw new Error(`Gamma ${res.status} ${res.statusText}: ${text.slice(0, 200)}`)
      }
      await sleep(RETRY_BACKOFF_MS * 2 ** attempt)
    }

    if (!Array.isArray(batch) || batch.length === 0) break
    for (const item of batch) {
      if (item && typeof item === "object") markets.push(item as GammaMarket)
    }
    if (maxMarkets != null && markets.length >= maxMarkets) {
      return markets.slice(0, maxMarkets)
    }
    if (batch.length < pageLimit) break
    offset += pageLimit
  }

  return markets
}
