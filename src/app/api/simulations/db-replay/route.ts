import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { parseStoredStrategyConfig } from "@/lib/strategy-templates"
import { runPolymarketDbSimulation } from "@/lib/simulation/polymarket-db-simulation"
import { z } from "zod"

export const maxDuration = 300
export const runtime = "nodejs"

const postSchema = z.object({
  strategyId: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  initialCapital: z.number().min(100).max(1_000_000),
  // max 200 markets supported; keep default low — 200 markets over 1yr can approach 60s
  maxMarkets: z.number().int().min(1).max(200).optional().default(30),
})

const MAX_WINDOW_MS = 730 * 86400_000

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) return NextResponse.json({ error: "Subscription required" }, { status: 403 })

  try {
    const json = await req.json()
    const data = postSchema.parse(json)

    const simStart = new Date(data.startDate)
    const simEnd = new Date(data.endDate)
    if (Number.isNaN(simStart.getTime()) || Number.isNaN(simEnd.getTime())) {
      return NextResponse.json({ error: "Invalid start or end date" }, { status: 400 })
    }
    if (simEnd <= simStart) return NextResponse.json({ error: "End date must be after start date" }, { status: 400 })
    const now = new Date()
    if (simEnd.getTime() > now.getTime()) {
      return NextResponse.json({ error: "End date must be in the past (resolved markets only)" }, { status: 400 })
    }
    if (simEnd.getTime() - simStart.getTime() > MAX_WINDOW_MS) {
      return NextResponse.json({ error: "Simulation window cannot exceed 730 days" }, { status: 400 })
    }

    const strategy = await prisma.strategy.findFirst({
      where: { id: data.strategyId, userId: session.id, isActive: true },
    })
    if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 })
    if (strategy.platform !== "polymarket") {
      return NextResponse.json({ error: "DB replay requires a Polymarket strategy" }, { status: 400 })
    }

    const parsed = parseStoredStrategyConfig(JSON.parse(strategy.config) as unknown)
    if (!parsed.ok) return NextResponse.json({ error: "Invalid strategy configuration" }, { status: 400 })

    const sim = await prisma.simulation.create({
      data: {
        userId: session.id,
        strategyId: data.strategyId,
        name: data.name,
        status: "RUNNING",
        startDate: simStart,
        endDate: simEnd,
        initialCapital: data.initialCapital,
        platform: "polymarket",
      },
    })

    try {
      const { metrics, trades } = await runPolymarketDbSimulation({
        strategyConfig: parsed.data,
        simStart,
        simEnd,
        initialCapital: data.initialCapital,
        maxMarkets: data.maxMarkets,
      })

      await prisma.simulation.update({
        where: { id: sim.id },
        data: {
          status: "COMPLETED",
          metricsJson: JSON.stringify(metrics),
          tradesJson: JSON.stringify(trades),
        },
      })

      return NextResponse.json({ id: sim.id, metrics, trades: trades.slice(0, 100) }, { status: 201 })
    } catch (err) {
      await prisma.simulation.update({ where: { id: sim.id }, data: { status: "FAILED" } })
      throw err
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? "Invalid input" }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 })
  }
}

