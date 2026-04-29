import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { z } from "zod"
import { normalizeIncomingStrategyConfigBody, parseStoredStrategyConfig, storedStrategyConfigZ } from "@/lib/strategy-templates"
import type { StoredStrategyConfig } from "@/types"

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  platform: z.enum(["polymarket", "kaishi", "generic"]),
  config: storedStrategyConfigZ,
})

function normalizeForStorage(config: z.infer<typeof storedStrategyConfigZ>): StoredStrategyConfig {
  return { ...config, version: 1 } as StoredStrategyConfig
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const strategies = await prisma.strategy.findMany({
    where: { userId: session.id, isActive: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json(
    strategies.map((s) => {
      const raw = JSON.parse(s.config) as unknown
      const parsed = parseStoredStrategyConfig(raw)
      if (parsed.ok) {
        return { ...s, config: parsed.data }
      }
      return { ...s, config: raw }
    })
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
    normalizeIncomingStrategyConfigBody(body)
    const data = createSchema.parse(body)
    const stored = normalizeForStorage(data.config)

    const strategy = await prisma.strategy.create({
      data: {
        userId: session.id,
        name: data.name,
        description: data.description,
        platform: data.platform,
        config: JSON.stringify(stored),
      },
    })

    return NextResponse.json({ ...strategy, config: stored }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
