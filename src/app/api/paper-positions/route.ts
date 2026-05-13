import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_CLOB = "https://clob.polymarket.com"
function clobBase(): string {
  return (process.env.CLOB_BASE_URL ?? DEFAULT_CLOB).replace(/\/+$/, "")
}

type BookSide = Array<{ price: string | number; size: string | number }>

/**
 * Fetch best bid + best ask from CLOB orderbook for a token.
 * Returns null if the book is empty or unreachable. Mid is (bid+ask)/2;
 * if only one side is present we fall back to that price.
 */
async function fetchBookMid(tokenId: string): Promise<{ bid: number | null; ask: number | null; mid: number | null }> {
  try {
    const res = await fetch(`${clobBase()}/book?token_id=${encodeURIComponent(tokenId)}`,
      { signal: AbortSignal.timeout(5000), cache: "no-store" })
    if (!res.ok) return { bid: null, ask: null, mid: null }
    const data = await res.json() as { bids?: BookSide; asks?: BookSide }
    let bestBid: number | null = null
    let bestAsk: number | null = null
    if (Array.isArray(data.bids)) {
      for (const b of data.bids) {
        const p = Number(b.price)
        if (Number.isFinite(p) && (bestBid == null || p > bestBid)) bestBid = p
      }
    }
    if (Array.isArray(data.asks)) {
      for (const a of data.asks) {
        const p = Number(a.price)
        if (Number.isFinite(p) && (bestAsk == null || p < bestAsk)) bestAsk = p
      }
    }
    let mid: number | null = null
    if (bestBid != null && bestAsk != null) mid = (bestBid + bestAsk) / 2
    else if (bestBid != null) mid = bestBid
    else if (bestAsk != null) mid = bestAsk
    return { bid: bestBid, ask: bestAsk, mid }
  } catch {
    return { bid: null, ask: null, mid: null }
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  const positions = await prisma.paperPosition.findMany({
    where: { userId: session.id },
    select: {
      id: true,
      strategyId: true,
      marketSlug: true,
      marketQuestion: true,
      side: true,
      tokenId: true,
      endDate: true,
      entryTime: true,
      entryMid: true,
      entryFillPrice: true,
      positionSizeUsd: true,
      shares: true,
      status: true,
      exitTime: true,
      exitMid: true,
      exitFillPrice: true,
      exitReason: true,
      pnlUsd: true,
      strategy: { select: { id: true, name: true } },
    },
    orderBy: [
      { status: "asc" },        // OPEN before CLOSED/RESOLVED
      { entryTime: "desc" },
    ],
  })

  // Live mark for OPEN positions — parallel CLOB orderbook fetch.
  // Mid = (best bid + best ask) / 2. For NO positions, the mark price is the
  // "fair value" of the NO token right now; unrealized PnL = shares × (mark − entry fill).
  const openPositions = positions.filter((p) => p.status === "OPEN")
  const marks = new Map<string, { bid: number | null; ask: number | null; mid: number | null }>()
  await Promise.all(
    openPositions.map(async (p) => {
      marks.set(p.id, await fetchBookMid(p.tokenId))
    })
  )

  // Aggregate stats over closed positions
  const closed = positions.filter((p) => p.status !== "OPEN")
  const wins = closed.filter((p) => (p.pnlUsd ?? 0) > 0).length
  const losses = closed.filter((p) => (p.pnlUsd ?? 0) <= 0).length
  const totalPnl = closed.reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const grossWin = closed.filter((p) => (p.pnlUsd ?? 0) > 0).reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const grossLoss = Math.abs(closed.filter((p) => (p.pnlUsd ?? 0) <= 0).reduce((s, p) => s + (p.pnlUsd ?? 0), 0))

  // Unrealized PnL across open positions (only counts positions where we got a mark)
  const unrealizedPnl = openPositions.reduce((s, p) => {
    const mid = marks.get(p.id)?.mid
    if (mid == null) return s
    return s + p.shares * (mid - p.entryFillPrice)
  }, 0)

  const stats = {
    totalPositions: positions.length,
    openCount: openPositions.length,
    closedCount: closed.length,
    wins,
    losses,
    winRate: closed.length > 0 ? wins / closed.length : null,
    totalPnL: Math.round(totalPnl * 100) / 100,
    avgPnL: closed.length > 0 ? Math.round((totalPnl / closed.length) * 100) / 100 : null,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    totalDeployedUsd: openPositions.reduce((s, p) => s + p.positionSizeUsd, 0),
    unrealizedPnL: Math.round(unrealizedPnl * 100) / 100,
    marksAvailable: Array.from(marks.values()).filter((m) => m.mid != null).length,
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    stats,
    positions: positions.map((p) => {
      const mark = p.status === "OPEN" ? marks.get(p.id) ?? null : null
      const currentMid = mark?.mid ?? null
      const unrealizedPnlUsd = currentMid != null ? p.shares * (currentMid - p.entryFillPrice) : null
      const unrealizedPct = unrealizedPnlUsd != null && p.positionSizeUsd > 0
        ? unrealizedPnlUsd / p.positionSizeUsd
        : null
      return {
        id: p.id,
        strategyId: p.strategyId,
        strategyName: p.strategy?.name ?? "",
        marketSlug: p.marketSlug,
        marketQuestion: p.marketQuestion,
        side: p.side,
        status: p.status,
        endDate: p.endDate.toISOString(),
        entryTime: p.entryTime.toISOString(),
        entryMid: p.entryMid,
        entryFillPrice: p.entryFillPrice,
        positionSizeUsd: p.positionSizeUsd,
        shares: p.shares,
        currentBid: mark?.bid ?? null,
        currentAsk: mark?.ask ?? null,
        currentMid,
        unrealizedPnlUsd: unrealizedPnlUsd != null ? Math.round(unrealizedPnlUsd * 100) / 100 : null,
        unrealizedPct,
        exitTime: p.exitTime?.toISOString() ?? null,
        exitMid: p.exitMid ?? null,
        exitFillPrice: p.exitFillPrice ?? null,
        exitReason: p.exitReason ?? null,
        pnlUsd: p.pnlUsd ?? null,
        urlPath: `https://polymarket.com/market/${p.marketSlug}`,
      }
    }),
  })
}
