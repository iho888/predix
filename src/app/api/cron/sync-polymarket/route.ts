import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { runDailySync } from "@/lib/sync/run-daily-sync"

export const runtime = "nodejs"

// Vercel cron sends GET; keep POST for manual/curl triggers too.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handler(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handler(req)
}

async function handler(req: NextRequest): Promise<NextResponse> {
  // Observability hook: log every hit before the auth check so Vercel logs
  // show whether the cron is firing at all. Until B-0005 is closed we have no
  // other way to distinguish "cron never fired" from "cron fired but 401'd".
  const userAgent = req.headers.get("user-agent") ?? ""
  const isVercelCron = userAgent.includes("vercel-cron")
  console.log(`[cron/sync-polymarket] hit ua=${userAgent.slice(0, 60)} vercel-cron=${isVercelCron}`)

  const expected = process.env.CRON_SECRET
  const xSecret = req.headers.get("x-cron-secret")
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!expected || (xSecret !== expected && bearer !== expected)) {
    console.error(
      `[cron/sync-polymarket] 401: expected=${expected ? "set" : "MISSING"} ` +
      `xSecret=${xSecret ? "present" : "absent"} bearer=${bearer ? "present" : "absent"}`
    )
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

