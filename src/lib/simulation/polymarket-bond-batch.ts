import { filterClosedMarketsByBondParams } from "@/lib/gamma/watchlist-filter"
import { getPriceHistory } from "@/lib/polymarket/clob"
import {
  fetchClosedMarkets,
  passesPolymarketBatchBinaryGate,
  rawToSimulationMarket,
} from "@/lib/polymarket/gamma"
import type { SimulationMarket } from "@/lib/polymarket/types"
import type {
  HighProbabilityBondParams,
  PolymarketBatchSimulationMetrics,
  PolymarketSimulationBatchCounters,
  SimulatedTradeRow,
} from "@/types"
import {
  entryBandOk,
  exitPriceForSide,
  leadingSideAtYesPrice,
  randomSimId,
} from "@/lib/simulation/polymarket-sim-shared"
import { format, startOfMonth } from "date-fns"

function buildBatchCounters(
  base: Omit<
    PolymarketSimulationBatchCounters,
    "totalTrades" | "winningTrades" | "matchRate"
  >,
  executed: SimulatedTradeRow[]
): PolymarketSimulationBatchCounters {
  const poly = executed.filter((r): r is Extract<SimulatedTradeRow, { source: "polymarket" }> => r.source === "polymarket")
  const winningTrades = poly.filter((t) => t.won).length
  const totalTrades = poly.length
  const matchRate =
    base.totalSlugsFetched === 0 ? 0 : Math.round((base.matchedMarkets / base.totalSlugsFetched) * 10000) / 100
  return {
    ...base,
    totalTrades,
    winningTrades,
    matchRate,
  }
}

function metricsFromPolymarketBatch(
  trades: Extract<SimulatedTradeRow, { source: "polymarket" }>[],
  initialCapital: number,
  counters: PolymarketSimulationBatchCounters
): PolymarketBatchSimulationMetrics {
  const n = trades.length
  const winners = trades.filter((t) => t.won)
  const losers = trades.filter((t) => !t.won)

  const totalPnL = Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100
  const finalCapital = Math.round((initialCapital + totalPnL) * 100) / 100

  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))

  let cum = 0
  let peak = initialCapital
  let maxDrawdown = 0
  const equitySteps: { date: Date; equity: number }[] = [{ date: new Date(), equity: initialCapital }]
  for (const t of trades) {
    cum += t.pnl
    const eq = initialCapital + cum
    const d = t.historyFirstT != null ? new Date(t.historyFirstT * 1000) : new Date()
    equitySteps.push({ date: d, equity: eq })
    if (eq > peak) peak = eq
    const dd = peak - eq
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const winRatePct =
    n === 0 ? 0 : Math.round((winners.length / n) * 10000) / 100

  const dailyReturns: number[] = []
  for (let i = 1; i < equitySteps.length; i++) {
    const prev = equitySteps[i - 1].equity
    if (prev <= 0) continue
    dailyReturns.push((equitySteps[i].equity - prev) / prev)
  }
  const avgReturn = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1)
  const stdReturn = Math.sqrt(
    dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length || 1)
  )
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0

  const equityCurve = equitySteps.map(({ date, equity }) => ({
    date: format(date, "yyyy-MM-dd"),
    equity: Math.round(equity * 100) / 100,
    drawdown: 0,
  }))

  const monthlyMap = new Map<string, number[]>()
  for (const t of trades) {
    const d = t.historyFirstT != null ? new Date(t.historyFirstT * 1000) : new Date()
    const key = format(startOfMonth(d), "yyyy-MM")
    if (!monthlyMap.has(key)) monthlyMap.set(key, [])
    monthlyMap.get(key)!.push(t.pnl)
  }
  const monthlyReturns = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnls]) => {
      const ret = pnls.reduce((s, p) => s + p, 0)
      return {
        month,
        return: Math.round(ret * 100) / 100,
        returnPct: Math.round((ret / initialCapital) * 10000) / 100,
      }
    })

  const wins = winners.length
  const platformBreakdown: PolymarketBatchSimulationMetrics["platformBreakdown"] = {
    polymarket: {
      trades: n,
      pnl: totalPnL,
      winRate: winRatePct,
    },
  }

  return {
    totalTrades: n,
    winningTrades: wins,
    losingTrades: n - wins,
    winRate: winRatePct,
    totalPnL,
    totalPnLPct: Math.round((totalPnL / initialCapital) * 10000) / 100,
    avgWin: wins > 0 ? Math.round((grossProfit / wins) * 100) / 100 : 0,
    avgLoss: losers.length > 0 ? Math.round((grossLoss / losers.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round((maxDrawdown / initialCapital) * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    finalCapital,
    initialCapital,
    roi: Math.round(((finalCapital - initialCapital) / initialCapital) * 10000) / 100,
    avgTradeDurationDays: 0,
    bestTrade: wins > 0 ? Math.round(Math.max(...winners.map((t) => t.pnl)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map((t) => t.pnl)) * 100) / 100 : 0,
    equityCurve,
    monthlyReturns,
    platformBreakdown,
    batch: counters,
    runKind: "closed_batch",
    polymarketMeta: {
      entryRule: "clob_first_candle",
      endWithinDaysApplied: false,
      gammaWinnerField: "outcomePrices_binaryThreshold",
    },
  }
}

async function paperTradeOneMarket(
  market: SimulationMarket,
  params: HighProbabilityBondParams,
  initialCapital: number
): Promise<
  | { ok: true; row: Extract<SimulatedTradeRow, { source: "polymarket" }> }
  | { ok: false; reason: "no_history" | "no_winner" | "entry_band" }
> {
  if (market.winningOutcomeIndex == null) return { ok: false, reason: "no_winner" }

  const yesTokenId = market.clobTokenIds[0]
  const history = await getPriceHistory(yesTokenId, "max", 720)
  if (history.length === 0) return { ok: false, reason: "no_history" }

  const first = history[0]
  const { side, entryPrice, leadingPrice } = leadingSideAtYesPrice(first.p)
  if (!entryBandOk(leadingPrice, params)) return { ok: false, reason: "entry_band" }

  const exitPrice = exitPriceForSide(side, market.winningOutcomeIndex)
  const positionSizeUsd = Math.max(5, (initialCapital * params.positionSizePct) / 100)
  const shares = positionSizeUsd / entryPrice
  const pnl = Math.round(shares * (exitPrice - entryPrice) * 100) / 100
  const won = pnl > 0
  const tokenId = side === "YES" ? market.clobTokenIds[0] : market.clobTokenIds[1]

  return {
    ok: true,
    row: {
      source: "polymarket",
      id: randomSimId(),
      slug: market.slug,
      question: market.question,
      tokenId,
      side,
      entryPrice: Math.round(entryPrice * 1e6) / 1e6,
      exitPrice,
      positionSizeUsd: Math.round(positionSizeUsd * 100) / 100,
      pnl,
      won,
      entryRule: "clob_first_candle",
      historyFirstT: first.t,
    },
  }
}

export interface PolymarketBondBatchResult {
  trades: SimulatedTradeRow[]
  metrics: PolymarketBatchSimulationMetrics
}

/**
 * Sync MVP: one Gamma page (`maxMarkets` ≤ 25), closed bond filter, binary + neg_risk gate,
 * CLOB first-candle entry only (see docs/simulations-polymarket-only-plan.md).
 */
export async function runPolymarketBondBatchSimulation(options: {
  bondParams: HighProbabilityBondParams
  initialCapital: number
  maxMarkets: number
}): Promise<PolymarketBondBatchResult> {
  const maxMarkets = Math.min(25, Math.max(1, Math.floor(options.maxMarkets)))
  const rawRows = await fetchClosedMarkets({ limit: maxMarkets, offset: 0 })
  const totalSlugsFetched = rawRows.length

  const bondPassed = filterClosedMarketsByBondParams(rawRows, options.bondParams)
  const matchedMarkets = bondPassed.length
  const skippedNoMatch = totalSlugsFetched - matchedMarkets

  let skippedNonBinary = 0
  let skippedNoHistory = 0
  let skippedEntryBand = 0

  const executed: Extract<SimulatedTradeRow, { source: "polymarket" }>[] = []
  const seen = new Set<string>()

  for (const row of bondPassed) {
    if (!passesPolymarketBatchBinaryGate(row as Record<string, unknown>)) {
      skippedNonBinary++
      continue
    }
    const market = rawToSimulationMarket(row as Record<string, unknown>)
    if (!market) {
      skippedNonBinary++
      continue
    }
    if (seen.has(market.slug)) continue
    seen.add(market.slug)

    const res = await paperTradeOneMarket(market, options.bondParams, options.initialCapital)
    if (!res.ok) {
      if (res.reason === "no_history") skippedNoHistory++
      else if (res.reason === "entry_band") skippedEntryBand++
      else skippedNonBinary++
      continue
    }
    executed.push(res.row)
  }

  const counterBase: Omit<PolymarketSimulationBatchCounters, "totalTrades" | "winningTrades" | "matchRate"> = {
    totalSlugsFetched,
    matchedMarkets,
    skippedNonBinary,
    skippedNoMatch,
    skippedNoHistory,
    skippedEntryBand,
  }
  const counters = buildBatchCounters(counterBase, executed)
  const metrics = metricsFromPolymarketBatch(executed, options.initialCapital, counters)

  return { trades: executed, metrics }
}
