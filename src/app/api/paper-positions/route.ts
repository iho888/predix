import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

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

  // Aggregate stats over closed positions
  const closed = positions.filter((p) => p.status !== "OPEN")
  const wins = closed.filter((p) => (p.pnlUsd ?? 0) > 0).length
  const losses = closed.filter((p) => (p.pnlUsd ?? 0) <= 0).length
  const totalPnl = closed.reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const grossWin = closed.filter((p) => (p.pnlUsd ?? 0) > 0).reduce((s, p) => s + (p.pnlUsd ?? 0), 0)
  const grossLoss = Math.abs(closed.filter((p) => (p.pnlUsd ?? 0) <= 0).reduce((s, p) => s + (p.pnlUsd ?? 0), 0))

  const stats = {
    totalPositions: positions.length,
    openCount: positions.filter((p) => p.status === "OPEN").length,
    closedCount: closed.length,
    wins,
    losses,
    winRate: closed.length > 0 ? wins / closed.length : null,
    totalPnL: Math.round(totalPnl * 100) / 100,
    avgPnL: closed.length > 0 ? Math.round((totalPnl / closed.length) * 100) / 100 : null,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    totalDeployedUsd: positions
      .filter((p) => p.status === "OPEN")
      .reduce((s, p) => s + p.positionSizeUsd, 0),
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    stats,
    positions: positions.map((p) => ({
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
      exitTime: p.exitTime?.toISOString() ?? null,
      exitMid: p.exitMid ?? null,
      exitFillPrice: p.exitFillPrice ?? null,
      exitReason: p.exitReason ?? null,
      pnlUsd: p.pnlUsd ?? null,
      urlPath: `https://polymarket.com/market/${p.marketSlug}`,
    })),
  })
}
