import { prisma } from "@/lib/db"
import { isBinaryNonNegRiskMarket, type GammaMarketRow } from "@/lib/sync/ingest-markets"
import { ingestYesCandlesForMarket } from "@/lib/sync/ingest-candles"

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

function inferWinningOutcomeIndex(prices: unknown[]): 0 | 1 | null {
  if (prices.length < 2) return null
  const p0 = Number(prices[0])
  const p1 = Number(prices[1])
  if (!Number.isFinite(p0) || !Number.isFinite(p1)) return null
  if (p0 >= 0.99) return 0
  if (p1 >= 0.99) return 1
  if (p0 > p1) return 0
  if (p1 > p0) return 1
  return null
}

function pickYesTokenId(tokenIds: string[]): string | null {
  const first = tokenIds[0]?.trim()
  return first || null
}

function marketEndInWindow(row: GammaMarketRow, startDate: Date, endDate: Date): boolean {
  const end = parseDateOrNull(row.endDate ?? row.endDateIso)
  if (!end) return false
  return end.getTime() >= startDate.getTime() && end.getTime() <= endDate.getTime()
}

export type FetchHistoricRangeOptions = {
  startDate: Date
  endDate: Date
  maxMarkets?: number
  fidelityMinutes?: number
  delayMs?: number
  syncType?: string
  onProgress?: (msg: string) => void
}

export type FetchHistoricRangeResult = {
  syncLogId: string
  marketsAdded: number
  marketsUpdated: number
  candlesAdded: number
  marketsProcessed: number
}

export async function fetchHistoricRange(options: FetchHistoricRangeOptions): Promise<FetchHistoricRangeResult> {
  const {
    startDate,
    endDate,
    maxMarkets = 500,
    fidelityMinutes = Number(process.env.CANDLE_FIDELITY_MINUTES ?? 60),
    delayMs = Number(process.env.SYNC_DELAY_MS ?? 200),
    syncType = "historic",
    onProgress,
  } = options

  const log = await prisma.dataSyncLog.create({
    data: { status: "running", syncType },
  })

  let marketsAdded = 0
  let marketsUpdated = 0
  let candlesAdded = 0
  let marketsProcessed = 0

  const root = gammaBaseUrl()
  const pageSize = 100
  let offset = 0
  const seen = new Set<string>()

  // Upserted market metadata needed for candle ingestion
  const upserted: { slug: string; yesTokenId: string; startDate: Date | null; endDate: Date | null }[] = []

  try {
    // Phase 1: paginate Gamma API for closed markets in the date window
    for (let page = 0; page < 200 && upserted.length < maxMarkets; page++) {
      const params = new URLSearchParams()
      params.set("closed", "true")
      params.set("limit", String(pageSize))
      params.set("offset", String(offset))
      params.set("order", "end_date")
      params.set("ascending", "false")
      params.set("end_date_min", startDate.toISOString().slice(0, 10))
      params.set("end_date_max", endDate.toISOString().slice(0, 10))

      let res = await fetch(`${root}/markets?${params}`, { cache: "no-store" })
      if (!res.ok) {
        // Retry without date filters (API may not support them)
        params.delete("end_date_min")
        params.delete("end_date_max")
        res = await fetch(`${root}/markets?${params}`, { cache: "no-store" })
      }
      if (!res.ok) break

      const batch: unknown = await res.json()
      if (!Array.isArray(batch) || batch.length === 0) break

      for (const item of batch) {
        if (!item || typeof item !== "object") continue
        if (upserted.length >= maxMarkets) break

        const row = item as GammaMarketRow
        if (!isBinaryNonNegRiskMarket(row)) continue
        if (!marketEndInWindow(row, startDate, endDate)) continue

        const slug = String(row.slug ?? "").trim()
        if (!slug || seen.has(slug)) continue
        seen.add(slug)

        const outcomes = parseJsonArray(row.outcomes).map((o) => String(o))
        const tokenIds = parseJsonArray(row.clobTokenIds).map((o) => String(o))
        if (outcomes.length !== 2 || tokenIds.length !== 2) continue

        const closed = Boolean(row.closed)
        const outcomePrices = parseJsonArray(row.outcomePrices)
        const winningOutcomeIndex = closed ? inferWinningOutcomeIndex(outcomePrices) : null
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
          startDate: parseDateOrNull(row.startDate ?? row.startDateIso ?? row.createdAt),
          endDate: parseDateOrNull(row.endDate ?? row.endDateIso),
          liquidityNum: toNumOrNull(row.liquidityNum),
          volumeNum: toNumOrNull(row.volumeNum),
          winningOutcomeIndex,
          lastSyncedAt: now,
        }

        try {
          await prisma.polymarketMarket.create({ data })
          marketsAdded++
        } catch {
          await prisma.polymarketMarket.update({ where: { slug }, data })
          marketsUpdated++
        }

        const yesTokenId = pickYesTokenId(tokenIds)
        if (yesTokenId) {
          upserted.push({ slug, yesTokenId, startDate: data.startDate, endDate: data.endDate })
        }
      }

      offset += batch.length
      if (batch.length < pageSize) break
    }

    onProgress?.(`Markets upserted: ${marketsAdded + marketsUpdated} (${marketsAdded} new, ${marketsUpdated} updated). Fetching candles...`)

    // Phase 2: fetch price candles for each upserted market
    for (const m of upserted) {
      const startTime = m.startDate ?? startDate
      const endTime = m.endDate ?? endDate

      if (endTime.getTime() <= startTime.getTime()) continue

      const res = await ingestYesCandlesForMarket({
        marketSlug: m.slug,
        yesTokenId: m.yesTokenId,
        startTime,
        endTime,
        fidelityMinutes,
        delayMs,
      })
      candlesAdded += res.candlesAdded
      marketsProcessed++

      await prisma.polymarketMarket.update({
        where: { slug: m.slug },
        data: { lastSyncedAt: new Date() },
      })

      if (marketsProcessed % 10 === 0) {
        onProgress?.(`Candles progress: ${marketsProcessed}/${upserted.length} markets, ${candlesAdded} candles added`)
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

    onProgress?.(`Done. ${marketsAdded} added, ${marketsUpdated} updated, ${candlesAdded} candles stored.`)
  } catch (err) {
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
        marketsAdded,
        marketsUpdated,
        candlesAdded,
      },
    })
    throw err
  }

  return { syncLogId: log.id, marketsAdded, marketsUpdated, candlesAdded, marketsProcessed }
}
