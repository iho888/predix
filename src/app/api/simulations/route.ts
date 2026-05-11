import { NextRequest, NextResponse } from "next/server"

export const maxDuration = 300
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { runSimulation } from "@/lib/simulation/engine"
import { parseStoredStrategyConfig, storedConfigToStrategyConfig } from "@/lib/strategy-templates"
import { Platform } from "@/types"
import { z } from "zod"

const createSchema = z.object({
  strategyId: z.string(),
  name: z.string().min(1).max(100),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.number().min(100).max(1000000),
})

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const simulations = await prisma.simulation.findMany({
    where: { userId: session.id },
    orderBy: { createdAt: "desc" },
    include: { strategy: { select: { name: true, platform: true } } },
  })

  return NextResponse.json(
    simulations.map((s) => ({
      ...s,
      metrics: s.metricsJson ? JSON.parse(s.metricsJson) : null,
    }))
  )
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const strategy = await prisma.strategy.findFirst({
      where: { id: data.strategyId, userId: session.id, isActive: true },
    })
    if (!strategy) return NextResponse.json({ error: "Strategy not found" }, { status: 404 })

    const parsed = parseStoredStrategyConfig(JSON.parse(strategy.config) as unknown)
    if (!parsed.ok) {
      return NextResponse.json({ error: "Invalid strategy configuration" }, { status: 400 })
    }
    const runConfig = storedConfigToStrategyConfig(parsed.data)
    const startDate = new Date(data.startDate)
    const endDate = new Date(data.endDate)

    if (endDate <= startDate) {
      return NextResponse.json({ error: "End date must be after start date" }, { status: 400 })
    }

    // Create simulation record
    const sim = await prisma.simulation.create({
      data: {
        userId: session.id,
        strategyId: data.strategyId,
        name: data.name,
        status: "RUNNING",
        startDate,
        endDate,
        initialCapital: data.initialCapital,
        platform: strategy.platform,
      },
    })

    try {
      const { metrics, trades } = await runSimulation(
        runConfig,
        strategy.platform as Platform,
        startDate,
        endDate,
        data.initialCapital
      )

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
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 })
  }
}
