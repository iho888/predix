import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { parseStoredStrategyConfig } from "@/lib/strategy-templates"
import { fetchAllMarkets } from "@/lib/gamma/fetch-markets"
import { filterMarketsByFadeParams } from "@/lib/gamma/watchlist-filter"
import type { FadeFavoriteParams } from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_CLOB = "https://clob.polymarket.com"
function clobBase(): string {
  return (process.env.CLOB_BASE_URL ?? DEFAULT_CLOB).replace(/\/+$/, "")
}

function pickTokenIdForSide(clobTokenIdsJson: unknown, side: "YES" | "NO"): string | null {
  let arr = clobTokenIdsJson
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr) } catch { return null }
  }
  if (!Array.isArray(arr) || arr.length < 2) return null
  const idx = side === "YES" ? 0 : 1
  const raw = arr[idx]
  const s = raw != null ? String(raw).trim() : ""
  return s || null
}

/** Fetch the current best NO ask price for a token via CLOB orderbook. */
async function fetchBestAsk(tokenId: string): Promise<number | null> {
  try {
    const res = await fetch(`${clobBase()}/book?token_id=${encodeURIComponent(tokenId)}`,
      { signal: AbortSignal.timeout(10000), cache: "no-store" })
    if (!res.ok) return null
    const data = await res.json() as { asks?: Array<{ price: string | number; size: string | number }> }
    if (!Array.isArray(data.asks) || data.asks.length === 0) return null
    let best: number | null = null
    for (const a of data.asks) {
      const p = Number(a.price)
      if (Number.isFinite(p) && (best == null || p < best)) best = p
    }
    return best
  } catch { return null }
}

// Vercel cron sends GET requests; keep POST for manual/curl triggers too.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handler(req)
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handler(req)
}

async function handler(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET
  const xSecret = req.headers.get("x-cron-secret")
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
  if (!expected || (xSecret !== expected && bearer !== expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = new Date()
  let opened = 0
  let closed = 0
  let scanned = 0
  const errors: string[] = []

  try {
    // 1) Find active fade_favorite strategies
    const strategies = await prisma.strategy.findMany({
      where: { isActive: true },
      select: { id: true, userId: true, config: true, name: true },
    })
    const fadeStrats: Array<{ id: string; userId: string; name: string; params: FadeFavoriteParams }> = []
    for (const s of strategies) {
      try {
        const parsed = parseStoredStrategyConfig(JSON.parse(s.config))
        if (parsed.ok && parsed.data.templateId === "fade_favorite") {
          fadeStrats.push({ id: s.id, userId: s.userId, name: s.name, params: parsed.data.params })
        }
      } catch { /* skip malformed */ }
    }
    if (fadeStrats.length === 0) {
      return NextResponse.json({ ok: true, note: "no active fade_favorite strategies", opened, closed, scanned })
    }

    // 2) Fetch live Gamma markets ONCE; reuse across strategies
    const baseUrl = (process.env.GAMMA_BASE_URL ?? "https://gamma-api.polymarket.com").replace(/\/+$/, "")
    const pageLimit = Math.min(100, Math.max(1, parseInt(process.env.GAMMA_PAGE_LIMIT ?? "100", 10) || 100))
    const maxMarkets = parseInt(process.env.LIVE_APPLY_MAX_MARKETS ?? "8000", 10) || 8000
    const markets = await fetchAllMarkets({
      baseUrl, pageLimit, maxMarkets,
      liquidityNumMin: null, volumeNumMin: null,
    })
    scanned = markets.length

    // 3) ENTRY pass: for each strategy, find current matches, open paper positions
    //    that aren't already open for the same (strategyId, marketSlug).
    for (const strat of fadeStrats) {
      const matches = filterMarketsByFadeParams(markets, strat.params, startedAt)
      if (matches.length === 0) continue

      // Existing open positions for this strategy
      const existingOpen = await prisma.paperPosition.findMany({
        where: { strategyId: strat.id, status: "OPEN" },
        select: { marketSlug: true },
      })
      const openSet = new Set(existingOpen.map((p) => p.marketSlug))

      // Cap concurrent positions per strategy at maxOpenPositions
      const headroom = Math.max(0, strat.params.maxOpenPositions - existingOpen.length)
      if (headroom <= 0) continue

      const newMatches = matches.filter((m) => !openSet.has(m.slug)).slice(0, headroom)

      // Resolve a representative cash basis. We don't track per-strategy cash
      // here; treat each paper position as a fixed slice based on a $1k notional.
      // Real money tracking comes in T-0014.
      const NOTIONAL = 1000
      const positionSizeUsd = Math.max(5, NOTIONAL * (strat.params.positionSizePct / 100))

      for (const match of newMatches) {
        try {
          // Fetch the live NO-side market data to compute fill price.
          const gamma = markets.find((g) =>
            String(g["slug"] ?? "") === match.slug
          ) as Record<string, unknown> | undefined
          if (!gamma) continue
          const tokenId = pickTokenIdForSide(gamma["clobTokenIds"], "NO")
          if (!tokenId) continue

          const yesMid = match.maxPrice
          const noMid = 1 - yesMid
          // Use orderbook ask if reachable; else fall back to noMid × (1+slip).
          const liveAsk = await fetchBestAsk(tokenId)
          const slip = strat.params.slippagePerLegPct ?? 0
          const fillPrice = liveAsk != null ? Math.min(0.999, liveAsk) : Math.min(0.999, noMid * (1 + slip))
          const shares = positionSizeUsd / fillPrice

          await prisma.paperPosition.create({
            data: {
              userId: strat.userId,
              strategyId: strat.id,
              marketSlug: match.slug,
              marketQuestion: match.question,
              side: "NO",
              tokenId,
              endDate: match.endDate ? new Date(match.endDate) : new Date(Date.now() + 365 * 86400000),
              entryTime: startedAt,
              entryMid: noMid,
              entryFillPrice: fillPrice,
              positionSizeUsd,
              shares,
              status: "OPEN",
            },
          })
          opened++
        } catch (e) {
          // Likely the unique constraint hit (race against parallel cron). Safe to ignore.
          if (!(e instanceof Error && e.message.includes("Unique"))) {
            errors.push(`open ${match.slug}: ${(e as Error).message}`)
          }
        }
      }
    }

    // 4) EXIT pass: any open position past maxHoldingDays needs closing.
    //    We compute maxHoldingDays per strategy and check each open position.
    for (const strat of fadeStrats) {
      const maxHold = strat.params.maxHoldingDays
      if (maxHold == null) continue
      const cutoff = new Date(startedAt.getTime() - maxHold * 86400000)
      const stale = await prisma.paperPosition.findMany({
        where: { strategyId: strat.id, status: "OPEN", entryTime: { lte: cutoff } },
      })

      for (const pos of stale) {
        try {
          // Get current NO ask price (or fall back to looking up by mid via CLOB)
          let exitMid: number | null = null
          let exitFillPrice: number | null = null
          let exitReason: "max_holding" | "resolution" = "max_holding"

          // If the market is past its endDate, settle as resolution (no slippage)
          if (pos.endDate.getTime() <= startedAt.getTime()) {
            // Without auth'd CLOB we can't know the resolution outcome cheaply.
            // Mark as RESOLVED with mid=0.5 placeholder; T-0014 will improve.
            // For now: try the NO ask and treat its mid as the exit.
            const ask = await fetchBestAsk(pos.tokenId)
            exitMid = ask ?? 0.5
            exitFillPrice = exitMid
            exitReason = "resolution"
          } else {
            const ask = await fetchBestAsk(pos.tokenId)
            const slip = strat.params.slippagePerLegPct ?? 0
            // For an exit, we'd hit the bid (lower than mid). Approximation:
            // exit mid = NO mid (we don't have YES book here); fill = mid × (1-slip).
            // If we have the live ask, the corresponding bid is approximately
            // ask - typical_spread; lacking it, use ask as a conservative upper bound.
            exitMid = ask != null ? ask : pos.entryMid
            exitFillPrice = Math.max(0.001, exitMid * (1 - slip))
            exitReason = "max_holding"
          }

          const pnlUsd = pos.shares * (exitFillPrice - pos.entryFillPrice)

          await prisma.paperPosition.update({
            where: { id: pos.id },
            data: {
              status: exitReason === "resolution" ? "RESOLVED" : "CLOSED",
              exitTime: startedAt,
              exitMid,
              exitFillPrice,
              exitReason,
              pnlUsd: Math.round(pnlUsd * 100) / 100,
            },
          })
          closed++
        } catch (e) {
          errors.push(`close ${pos.id}: ${(e as Error).message}`)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      strategies: fadeStrats.length,
      marketsScanned: scanned,
      opened, closed,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: (e as Error).message,
      opened, closed, scanned,
    }, { status: 500 })
  }
}
