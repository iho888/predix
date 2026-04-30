import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest, canAccessPlatform } from "@/lib/auth"
import { getMarketBySlug, searchClosedMarkets } from "@/lib/polymarket/gamma"
import { runSingleTradeSimulation } from "@/lib/simulation/runBacktest"
import { getStrategyById } from "@/lib/strategies/registry"
import { z } from "zod"

const postSchema = z.object({
  slug: z.string().min(1).max(200),
  strategyId: z.string().min(1).max(80),
})

export async function GET(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  const q = req.nextUrl.searchParams.get("search")?.trim() ?? ""
  if (q.length < 2) {
    return NextResponse.json({ hits: [] as { slug: string; question: string }[] })
  }

  try {
    const hits = await searchClosedMarkets(q, 15)
    return NextResponse.json({ hits })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: "Search failed" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canAccessPlatform(session)) {
    return NextResponse.json({ error: "Subscription required" }, { status: 403 })
  }

  try {
    const json = await req.json()
    const { slug, strategyId } = postSchema.parse(json)

    const meta = getStrategyById(strategyId)
    if (!meta) {
      return NextResponse.json({ error: "Unknown strategy" }, { status: 400 })
    }

    const market = await getMarketBySlug(slug)
    if (!market) {
      return NextResponse.json({ error: "Market not found for that slug" }, { status: 404 })
    }

    const backtest = await runSingleTradeSimulation(market, meta.fn)

    return NextResponse.json({
      strategyId: meta.id,
      strategyName: meta.name,
      market: {
        slug: market.slug,
        question: market.question,
        closed: market.closed,
        outcomes: market.outcomes,
        winningOutcomeIndex: market.winningOutcomeIndex,
      },
      backtest,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? "Invalid input" }, { status: 400 })
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Simulation failed" }, { status: 500 })
  }
}
