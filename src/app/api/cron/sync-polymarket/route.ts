import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { runDailySync } from "@/lib/sync/run-daily-sync"

export const runtime = "nodejs"

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET
  const got = req.headers.get("x-cron-secret")
  if (!expected || got !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date()
  const log = await prisma.dataSyncLog.create({
    data: { startedAt, status: "running", syncType: "cron", marketsAdded: 0, marketsUpdated: 0, candlesAdded: 0 },
  })

  try {
    const res = await runDailySync({ syncType: "cron" })
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), status: "completed", ...res },
    })
    return NextResponse.json({ syncLogId: log.id, ...res })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), status: "failed", errorMessage: msg.slice(0, 5000) },
    })
    return NextResponse.json({ syncLogId: log.id, error: msg }, { status: 500 })
  }
}

