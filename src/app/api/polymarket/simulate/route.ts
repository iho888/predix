import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { runPolymarketBondBatchSimulation } from "@/lib/simulation/polymarket-bond-batch"
import { parseStoredStrategyConfig } from "@/lib/strategy-templates"
import { z } from "zod"

export const maxDuration = 300

const postSchema = z.object({
  strategyId: z.string().min(1).max(80),
  name: z.string().min(1).max(100),
  initialCapital: z.number().min(100).max(1_000_000),
  maxMarkets: z.number().int().min(1).max(25).optional().default(25),
})

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  try {
    const json = await req.json()
    const data = postSchema.parse(json)

    const strategy = await prisma.strategy.findFirst({
      where: { id: data.strategyId, userId: session.id, isActive: true },
    })
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 })
    }
    if (strategy.platform !== "polymarket") {
      return NextResponse.json(
        { error: "Polymarket batch simulation requires a Polymarket strategy" },
        { status: 400 }
      )
    }

    const parsed = parseStoredStrategyConfig(JSON.parse(strategy.config) as unknown)
    if (!parsed.ok || parsed.data.templateId !== "high_probability_bond") {
      return NextResponse.json(
        { error: "Strategy must use the High-probability bond template" },
        { status: 400 }
      )
    }

    const now = new Date()
    const endDate = new Date(now.getTime() + 60_000)

    const sim = await prisma.simulation.create({
      data: {
        userId: session.id,
        strategyId: data.strategyId,
        name: data.name,
        status: "RUNNING",
        startDate: now,
        endDate,
        initialCapital: data.initialCapital,
        platform: "polymarket",
      },
    })

    try {
      const { trades, metrics } = await runPolymarketBondBatchSimulation({
        bondParams: parsed.data.params,
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

      return NextResponse.json(
        { id: sim.id, metrics, trades: trades.slice(0, 100) },
        { status: 201 }
      )
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
