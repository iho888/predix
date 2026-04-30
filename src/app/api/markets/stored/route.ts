import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"

export async function GET(): Promise<NextResponse> {
  const [totalMarkets, range, latestLog] = await Promise.all([
    prisma.polymarketMarket.count(),
    prisma.polymarketMarket.aggregate({
      _min: { endDate: true },
      _max: { endDate: true },
    }),
    prisma.dataSyncLog.findFirst({ orderBy: { startedAt: "desc" } }),
  ])

  return NextResponse.json({
    totalMarkets,
    earliestEndDate: range._min.endDate,
    latestEndDate: range._max.endDate,
    latestSync: latestLog,
  })
}

