import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { parseStoredStrategyConfig } from "@/lib/strategy-templates"
import { fetchAllMarkets } from "@/lib/gamma/fetch-markets"
import { filterMarketsByBondParams } from "@/lib/gamma/watchlist-filter"
import { z } from "zod"

const bodySchema = z.object({
  strategyId: z.string().min(1),
})

function maxMarketsLimit(): number {
  const n = parseInt(process.env.LIVE_APPLY_MAX_MARKETS ?? "8000", 10)
  if (!Number.isFinite(n) || n < 1) return 8000
  return Math.min(n, 50_000)
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  try {
    const json = await req.json()
    const { strategyId } = bodySchema.parse(json)

    const strategy = await prisma.strategy.findFirst({
      where: { id: strategyId, userId: session.id, isActive: true },
    })
    if (!strategy) {
      return NextResponse.json({ error: "Strategy not found" }, { status: 404 })
    }

    const parsed = parseStoredStrategyConfig(JSON.parse(strategy.config) as unknown)
    if (!parsed.ok) {
      return NextResponse.json({ error: "Invalid strategy configuration" }, { status: 400 })
    }
    if (parsed.data.templateId !== "high_probability_bond") {
      return NextResponse.json(
        {
          error:
            "Live apply is only available for High-probability bond strategies. Create one under Strategies or pick a different strategy.",
        },
        { status: 400 }
      )
    }

    const baseUrl = (process.env.GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com").replace(/\/+$/, "")
    const pageLimit = Math.min(100, Math.max(1, parseInt(process.env.GAMMA_PAGE_LIMIT ?? "100", 10) || 100))

    const markets = await fetchAllMarkets({
      baseUrl,
      pageLimit,
      maxMarkets: maxMarketsLimit(),
      liquidityNumMin: null,
      volumeNumMin: null,
    })

    const generatedAt = new Date().toISOString()
    const entries = filterMarketsByBondParams(markets, parsed.data.params, new Date())

    return NextResponse.json({
      generatedAt,
      strategyId: strategy.id,
      strategyName: strategy.name,
      marketsScanned: markets.length,
      matchCount: entries.length,
      entries: entries.map((e) => ({
        slug: e.slug,
        question: e.question,
        maxPrice: e.maxPrice,
        leadingOutcome: e.leadingOutcome,
        edgeToPar: e.edgeToPar,
        liquidityNum: e.liquidityNum,
        volumeNum: e.volumeNum,
        endDate: e.endDate,
        urlPath: e.urlPath,
      })),
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    const message = err instanceof Error ? err.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
