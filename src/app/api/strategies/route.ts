import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { z } from "zod"

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  platform: z.enum(["polymarket", "kaishi", "generic"]),
  config: z.object({
    entryConditions: z.object({
      outcome: z.enum(["YES", "NO", "LONG", "SHORT"]),
      minProbability: z.number().min(0).max(1).optional(),
      maxProbability: z.number().min(0).max(1).optional(),
      minVolume: z.number().min(0).optional(),
      trend: z.enum(["rising", "falling", "stable", "any"]).optional(),
      minLiquidity: z.number().min(0).optional(),
    }),
    exitConditions: z.object({
      takeProfitPct: z.number().min(0.01).max(10),
      stopLossPct: z.number().min(0.01).max(1),
      maxHoldingDays: z.number().int().min(1).optional(),
    }),
    positionSizePct: z.number().min(1).max(100),
    maxOpenPositions: z.number().int().min(1).max(20),
    minOdds: z.number().optional(),
    maxOdds: z.number().optional(),
  }),
})

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const strategies = await prisma.strategy.findMany({
    where: { userId: session.id, isActive: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(strategies.map((s) => ({
    ...s,
    config: JSON.parse(s.config),
  })))
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

    const strategy = await prisma.strategy.create({
      data: {
        userId: session.id,
        name: data.name,
        description: data.description,
        platform: data.platform,
        config: JSON.stringify(data.config),
      },
    })

    return NextResponse.json({ ...strategy, config: data.config }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
