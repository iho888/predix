import { prisma } from "@/lib/db"

const DEFAULT_CLOB = "https://clob.polymarket.com"

function clobBaseUrl(): string {
  return (process.env.CLOB_BASE_URL ?? DEFAULT_CLOB).replace(/\/+$/, "")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export type ClobPricePoint = { t: number; p: number }

export async function fetchClobPriceHistoryRange(options: {
  tokenId: string
  startTs: number
  endTs: number
  fidelityMinutes: number
  timeoutMs?: number
}): Promise<ClobPricePoint[]> {
  const root = clobBaseUrl()
  const p = new URLSearchParams()
  p.set("market", options.tokenId)
  p.set("startTs", String(Math.floor(options.startTs)))
  p.set("endTs", String(Math.floor(options.endTs)))
  p.set("fidelity", String(Math.max(60, Math.floor(options.fidelityMinutes))))

  const res = await fetch(`${root}/prices-history?${p}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  })
  if (!res.ok) return []
  const data: unknown = await res.json()
  if (!data || typeof data !== "object" || !("history" in data)) return []
  const hist = (data as { history?: unknown }).history
  if (!Array.isArray(hist)) return []

  const out: ClobPricePoint[] = []
  for (const row of hist) {
    if (!row || typeof row !== "object") continue
    const t = Number((row as { t?: unknown }).t)
    const pNum = Number((row as { p?: unknown }).p)
    if (!Number.isFinite(t) || !Number.isFinite(pNum)) continue
    out.push({ t, p: pNum })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

export type IngestCandlesResult = {
  candlesAdded: number
}

export async function ingestYesCandlesForMarket(options: {
  marketSlug: string
  yesTokenId: string
  startTime: Date
  endTime: Date
  fidelityMinutes?: number
  delayMs?: number
}): Promise<IngestCandlesResult> {
  const fidelityMinutes = options.fidelityMinutes ?? Number(process.env.CANDLE_FIDELITY_MINUTES ?? 60)
  const delayMs = options.delayMs ?? Number(process.env.SYNC_DELAY_MS ?? 200)

  const startTs = Math.floor(options.startTime.getTime() / 1000)
  const endTs = Math.floor(options.endTime.getTime() / 1000)

  const points = await fetchClobPriceHistoryRange({
    tokenId: options.yesTokenId,
    startTs,
    endTs,
    fidelityMinutes,
  })

  if (delayMs > 0) await sleep(delayMs)

  if (points.length === 0) return { candlesAdded: 0 }

  const rows = points.map((pt) => ({
    marketSlug: options.marketSlug,
    timestamp: new Date(pt.t * 1000),
    yesPrice: Math.max(0, Math.min(1, pt.p)),
  }))

  const created = await prisma.polymarketPriceCandle.createMany({
    data: rows,
    skipDuplicates: true,
  })

  return { candlesAdded: created.count }
}

