import { prisma } from "@/lib/db"
import { ingestYesCandlesForMarket } from "@/lib/sync/ingest-candles"
import { ingestMarketsFromGamma, isBinaryNonNegRiskMarket } from "@/lib/sync/ingest-markets"

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
  // Closed markets that settled below 0.99 — pick the higher price
  if (p0 > p1) return 0
  if (p1 > p0) return 1
  return null
}

async function fetchGammaMarketBySlug(slug: string): Promise<Record<string, unknown> | null> {
  const root = gammaBaseUrl()
  const trimmed = slug.trim()
  if (!trimmed) return null
  const res = await fetch(`${root}/markets/slug/${encodeURIComponent(trimmed)}`, { cache: "no-store" })
  if (!res.ok) return null
  const data: unknown = await res.json()
  if (!data || typeof data !== "object") return null
  return data as Record<string, unknown>
}

function pickYesTokenId(clobTokenIdsJson: unknown): string | null {
  if (!Array.isArray(clobTokenIdsJson)) return null
  const first = clobTokenIdsJson[0]
  const s = first != null ? String(first).trim() : ""
  return s ? s : null
}

export type RunDailySyncResult = {
  marketsAdded: number
  marketsUpdated: number
  candlesAdded: number
}

export async function runDailySync(options: { syncType: "cron" | "manual"; lookbackHours?: number; discoverMaxMarkets?: number; candidateLimit?: number }): Promise<RunDailySyncResult> {
  const lookbackHours = options.lookbackHours ?? 48
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000)
  const now = new Date()
  const isCron = options.syncType === "cron"

  // Phase 0 — discovery. Page Gamma /markets to upsert new markets we don't know
  // about yet. Without this, runDailySync only ever refreshes markets already in
  // our DB, so any new Polymarket market is invisible forever. Tracked as B-0005.
  //
  // Per-invocation caps for cron: must fit inside Vercel's 300s function cap.
  // Prior default (discover=1500, candidates=5000) was killed mid-Phase-0 every
  // run, so candle ingest never started. Lower defaults + lastSyncedAt-asc
  // candidate ordering means staler markets get refreshed first and the work
  // rotates across daily invocations.
  const defaultDiscover = isCron ? 400 : 1500
  const defaultCandidates = isCron ? 200 : 5000
  const discoverCap = options.discoverMaxMarkets ?? Number(process.env.SYNC_DISCOVER_MAX ?? defaultDiscover)
  const candidateCap = options.candidateLimit ?? Number(process.env.SYNC_CANDIDATE_LIMIT ?? defaultCandidates)
  const discovered = await ingestMarketsFromGamma({ maxMarkets: discoverCap })

  const candidates = await prisma.polymarketMarket.findMany({
    where: {
      OR: [{ active: true }, { updatedAt: { gte: cutoff } }, { lastSyncedAt: null }],
    },
    select: { slug: true, lastSyncedAt: true, startDate: true, endDate: true, clobTokenIdsJson: true },
    take: candidateCap,
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }],
  })

  let marketsAdded = discovered.marketsAdded
  let marketsUpdated = discovered.marketsUpdated
  let candlesAdded = 0

  for (const c of candidates) {
    const raw = await fetchGammaMarketBySlug(c.slug)
    if (!raw) continue
    if (!isBinaryNonNegRiskMarket(raw)) continue

    const slug = String(raw.slug ?? "").trim()
    if (!slug) continue

    const outcomes = parseJsonArray(raw.outcomes).map((o) => String(o))
    const tokenIds = parseJsonArray(raw.clobTokenIds).map((o) => String(o))
    if (outcomes.length !== 2 || tokenIds.length !== 2) continue

    const closed = Boolean(raw.closed)
    const outcomePrices = parseJsonArray(raw.outcomePrices)
    const winningOutcomeIndex = closed ? inferWinningOutcomeIndexFromPrices(outcomePrices) : null

    const data = {
      slug,
      question: String(raw.question ?? ""),
      conditionId: String(raw.conditionId ?? ""),
      outcomesJson: outcomes,
      clobTokenIdsJson: tokenIds,
      closed,
      active: Boolean(raw.active),
      negRisk: Boolean(raw.neg_risk),
      startDate: parseDateOrNull(raw.startDate),
      endDate: parseDateOrNull(raw.endDate ?? raw.endDateIso),
      liquidityNum: toNumOrNull(raw.liquidityNum),
      volumeNum: toNumOrNull(raw.volumeNum),
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

    const yesTokenId = pickYesTokenId(c.clobTokenIdsJson ?? tokenIds)
    if (!yesTokenId) continue

    const startTime = c.lastSyncedAt ?? c.startDate ?? cutoff
    const endTime = c.endDate ?? now
    if (endTime.getTime() <= startTime.getTime()) continue

    const res = await ingestYesCandlesForMarket({
      marketSlug: c.slug,
      yesTokenId,
      startTime,
      endTime,
    })
    candlesAdded += res.candlesAdded

    await prisma.polymarketMarket.update({
      where: { slug: c.slug },
      data: { lastSyncedAt: now },
    })
  }

  await prisma.dataSyncLog.create({
    data: {
      startedAt: now,
      finishedAt: new Date(),
      status: "completed",
      syncType: options.syncType,
      marketsAdded,
      marketsUpdated,
      candlesAdded,
    },
  })

  return { marketsAdded, marketsUpdated, candlesAdded }
}

