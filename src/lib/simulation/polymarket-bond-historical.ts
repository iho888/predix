import { endsWithinDays } from "@/lib/gamma/watchlist-filter"
import { fetchHistoricalResolvedMarkets } from "@/lib/gamma/fetch-historical-markets"
import { getPriceHistory } from "@/lib/polymarket/clob"
import { passesPolymarketBatchBinaryGate, rawToSimulationMarket } from "@/lib/polymarket/gamma"
import type { SimulationMarket } from "@/lib/polymarket/types"
import {
  entryBandOk,
  gammaLiquidityVolumeGatesOk,
  leadingSideAtYesPrice,
  randomSimId,
} from "@/lib/simulation/polymarket-sim-shared"
import { walkMarket, type WalkExitReason } from "@/lib/simulation/polymarket-walk-market"
import type {
  HighProbabilityBondParams,
  PolymarketBatchSimulationMetrics,
  PolymarketSimulationBatchCounters,
  SimulatedTradeRow,
} from "@/types"
import { differenceInDays, format, startOfMonth } from "date-fns"

interface RawCand {
  slug: string
  question: string
  market: SimulationMarket
  side: "YES" | "NO"
  entryTs: number
  exitTs: number
  entryPrice: number
  exitPrice: number
  exitReason: WalkExitReason
  winningOutcomeIndex: 0 | 1
  _sizeUsd?: number
  _shares?: number
}

function marketEndDateString(row: Record<string, unknown>): string | null {
  const raw = row.endDate ?? row.endDateIso
  if (raw == null) return null
  return String(raw)
}

async function tryBuildCandidate(
  row: Record<string, unknown>,
  simStart: Date,
  bondParams: HighProbabilityBondParams
): Promise<
  | { ok: true; c: RawCand }
  | {
      ok: false
      reason: "non_binary" | "no_winner" | "liq_vol" | "end_within" | "no_history" | "entry_band"
    }
> {
  if (!passesPolymarketBatchBinaryGate(row)) return { ok: false, reason: "non_binary" }
  const market = rawToSimulationMarket(row)
  if (!market) return { ok: false, reason: "non_binary" }
  if (market.winningOutcomeIndex == null) return { ok: false, reason: "no_winner" }

  if (!gammaLiquidityVolumeGatesOk(row, bondParams)) return { ok: false, reason: "liq_vol" }

  const endS = marketEndDateString(row)
  if (bondParams.endWithinDays != null) {
    if (!endsWithinDays({ endDate: endS }, bondParams.endWithinDays, simStart)) {
      return { ok: false, reason: "end_within" }
    }
  }

  const startUnix = Math.floor(simStart.getTime() / 1000)
  const history = await getPriceHistory(market.clobTokenIds[0], "max", 720)
  const relevant = history.filter((pt) => pt.t >= startUnix).sort((a, b) => a.t - b.t)
  if (relevant.length === 0) return { ok: false, reason: "no_history" }

  const entryCandle = relevant[0]!
  const { side, entryPrice, leadingPrice } = leadingSideAtYesPrice(entryCandle.p)
  if (!entryBandOk(leadingPrice, bondParams)) return { ok: false, reason: "entry_band" }

  const w = market.winningOutcomeIndex
  const walk = walkMarket(relevant, side, entryPrice, w, bondParams, entryCandle.t)

  return {
    ok: true,
    c: {
      slug: market.slug,
      question: market.question,
      market,
      side,
      entryTs: entryCandle.t,
      exitTs: walk.exitTs,
      entryPrice,
      exitPrice: walk.exitPrice,
      exitReason: walk.exitReason,
      winningOutcomeIndex: w,
    },
  }
}

function portfolioSelect(raw: RawCand[], maxOpen: number): { accepted: RawCand[]; skippedMaxPositions: number } {
  const sorted = [...raw].sort((a, b) => a.entryTs - b.entryTs)
  const active: { exitTs: number }[] = []
  const accepted: RawCand[] = []
  let skippedMaxPositions = 0

  for (const c of sorted) {
    const still = active.filter((x) => x.exitTs > c.entryTs)
    active.length = 0
    active.push(...still)
    if (active.length >= maxOpen) {
      skippedMaxPositions++
      continue
    }
    active.push({ exitTs: c.exitTs })
    accepted.push(c)
  }

  return { accepted, skippedMaxPositions }
}

type TimelineEv = { t: number; kind: "entry" | "exit"; c: RawCand }

function replayCapitalAndBuildRows(
  accepted: RawCand[],
  initialCapital: number,
  positionSizePct: number
): { rows: Extract<SimulatedTradeRow, { source: "polymarket" }>[]; equitySteps: { t: number; equity: number }[] } {
  const ev: TimelineEv[] = []
  for (const c of accepted) {
    ev.push({ t: c.entryTs, kind: "entry", c })
    ev.push({ t: c.exitTs, kind: "exit", c })
  }
  ev.sort((a, b) => {
    if (a.t !== b.t) return a.t - b.t
    return a.kind === "exit" ? -1 : 1
  })

  let cash = initialCapital
  const equitySteps: { t: number; equity: number }[] = []
  if (ev.length > 0) equitySteps.push({ t: ev[0]!.t, equity: cash })

  const rows: Extract<SimulatedTradeRow, { source: "polymarket" }>[] = []

  for (const e of ev) {
    if (e.kind === "entry") {
      const sizeUsd = Math.round(Math.max(5, (cash * positionSizePct) / 100) * 100) / 100
      const shares = sizeUsd / e.c.entryPrice
      e.c._sizeUsd = sizeUsd
      e.c._shares = shares
      cash -= sizeUsd
    } else {
      const sizeUsd = e.c._sizeUsd!
      const shares = e.c._shares!
      const pnl = Math.round(shares * (e.c.exitPrice - e.c.entryPrice) * 100) / 100
      cash += sizeUsd + pnl
      equitySteps.push({ t: e.t, equity: Math.round(cash * 100) / 100 })
      const tokenId = e.c.side === "YES" ? e.c.market.clobTokenIds[0] : e.c.market.clobTokenIds[1]
      rows.push({
        source: "polymarket",
        id: randomSimId(),
        slug: e.c.slug,
        question: e.c.question,
        tokenId,
        side: e.c.side,
        entryPrice: Math.round(e.c.entryPrice * 1e6) / 1e6,
        exitPrice: Math.round(e.c.exitPrice * 1e6) / 1e6,
        positionSizeUsd: sizeUsd,
        pnl,
        won: pnl > 0,
        entryRule: "clob_first_candle_after_start",
        historyFirstT: e.c.entryTs,
        historyExitT: e.c.exitTs,
        exitReason: e.c.exitReason,
        polymarketRun: "historical",
      })
    }
  }

  return { rows, equitySteps }
}

function buildCounters(
  totalSlugsFetched: number,
  prePortfolio: RawCand[],
  skipped: {
    skippedNonBinary: number
    skippedNoHistory: number
    skippedEntryBand: number
    skippedEndWithinDays: number
    skippedLiqVolGamma: number
    skippedNoWinner: number
    skippedMaxPositions: number
  },
  executed: SimulatedTradeRow[]
): PolymarketSimulationBatchCounters {
  const matchedMarkets = prePortfolio.length
  const skippedNoMatch = Math.max(
    0,
    totalSlugsFetched -
      matchedMarkets -
      skipped.skippedNonBinary -
      skipped.skippedNoHistory -
      skipped.skippedEntryBand -
      skipped.skippedEndWithinDays -
      skipped.skippedLiqVolGamma -
      skipped.skippedNoWinner
  )
  const poly = executed.filter((r): r is Extract<SimulatedTradeRow, { source: "polymarket" }> => r.source === "polymarket")
  const winningTrades = poly.filter((t) => t.won).length
  const totalTrades = poly.length
  const matchRate =
    totalSlugsFetched === 0 ? 0 : Math.round((matchedMarkets / totalSlugsFetched) * 10000) / 100
  return {
    totalSlugsFetched,
    matchedMarkets,
    skippedNonBinary: skipped.skippedNonBinary,
    skippedNoMatch,
    skippedNoHistory: skipped.skippedNoHistory,
    skippedEntryBand: skipped.skippedEntryBand,
    totalTrades,
    winningTrades,
    matchRate,
    skippedEndWithinDays: skipped.skippedEndWithinDays,
    skippedMaxPositions: skipped.skippedMaxPositions,
    skippedLiqVolGamma: skipped.skippedLiqVolGamma,
  }
}

function metricsFromHistorical(
  trades: Extract<SimulatedTradeRow, { source: "polymarket" }>[],
  initialCapital: number,
  counters: PolymarketSimulationBatchCounters,
  equitySteps: { t: number; equity: number }[],
  bondParams: HighProbabilityBondParams
): PolymarketBatchSimulationMetrics {
  const n = trades.length
  const winners = trades.filter((t) => t.won)
  const losers = trades.filter((t) => !t.won)

  const totalPnL = Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100
  const finalCapital = Math.round((initialCapital + totalPnL) * 100) / 100

  const grossProfit = winners.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))

  let peak = initialCapital
  let maxDrawdown = 0
  for (const { equity } of equitySteps) {
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const winRatePct = n === 0 ? 0 : Math.round((winners.length / n) * 10000) / 100

  const dailyReturns: number[] = []
  for (let i = 1; i < equitySteps.length; i++) {
    const prev = equitySteps[i - 1]!.equity
    if (prev <= 0) continue
    dailyReturns.push((equitySteps[i]!.equity - prev) / prev)
  }
  const avgReturn = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1)
  const stdReturn = Math.sqrt(
    dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length || 1)
  )
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0

  const equityCurve = equitySteps.map(({ t, equity }) => ({
    date: format(new Date(t * 1000), "yyyy-MM-dd"),
    equity: Math.round(equity * 100) / 100,
    drawdown: 0,
  }))

  const monthlyMap = new Map<string, number[]>()
  for (const t of trades) {
    const d = t.historyExitT != null ? new Date(t.historyExitT * 1000) : new Date()
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
  let durSum = 0
  for (const t of trades) {
    if (t.historyFirstT != null && t.historyExitT != null) {
      durSum += differenceInDays(new Date(t.historyExitT * 1000), new Date(t.historyFirstT * 1000))
    }
  }
  const avgTradeDurationDays = n > 0 ? Math.round((durSum / n) * 10) / 10 : 0

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
    avgTradeDurationDays,
    bestTrade: wins > 0 ? Math.round(Math.max(...winners.map((t) => t.pnl)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map((t) => t.pnl)) * 100) / 100 : 0,
    equityCurve,
    monthlyReturns,
    platformBreakdown,
    batch: counters,
    runKind: "historical",
    polymarketMeta: {
      entryRule: "clob_first_candle_after_start",
      endWithinDaysApplied: bondParams.endWithinDays != null,
      gammaWinnerField: "outcomePrices_binaryThreshold",
      gammaLiquidityVolumePointInTime: true,
    },
  }
}

export interface PolymarketBondHistoricalResult {
  trades: SimulatedTradeRow[]
  metrics: PolymarketBatchSimulationMetrics
}

export async function runPolymarketBondHistoricalSimulation(options: {
  bondParams: HighProbabilityBondParams
  initialCapital: number
  maxMarkets: number
  simStart: Date
  simEnd: Date
}): Promise<PolymarketBondHistoricalResult> {
  const maxMarkets = Math.min(100, Math.max(1, Math.floor(options.maxMarkets)))
  const discovered = await fetchHistoricalResolvedMarkets({
    simStart: options.simStart,
    simEnd: options.simEnd,
    maxMarkets,
  })
  const totalSlugsFetched = discovered.length

  let skippedNonBinary = 0
  let skippedNoHistory = 0
  let skippedEntryBand = 0
  let skippedEndWithinDays = 0
  let skippedLiqVolGamma = 0
  let skippedNoWinner = 0

  const prePortfolio: RawCand[] = []

  for (const row of discovered) {
    const r = await tryBuildCandidate(row as Record<string, unknown>, options.simStart, options.bondParams)
    if (!r.ok) {
      if (r.reason === "non_binary") skippedNonBinary++
      else if (r.reason === "no_history") skippedNoHistory++
      else if (r.reason === "entry_band") skippedEntryBand++
      else if (r.reason === "end_within") skippedEndWithinDays++
      else if (r.reason === "liq_vol") skippedLiqVolGamma++
      else if (r.reason === "no_winner") skippedNoWinner++
      continue
    }
    prePortfolio.push(r.c)
  }

  const { accepted, skippedMaxPositions } = portfolioSelect(prePortfolio, options.bondParams.maxOpenPositions)
  let { rows, equitySteps } = replayCapitalAndBuildRows(
    accepted,
    options.initialCapital,
    options.bondParams.positionSizePct
  )
  if (equitySteps.length === 0) {
    equitySteps = [{ t: Math.floor(options.simStart.getTime() / 1000), equity: options.initialCapital }]
  }

  const counters = buildCounters(
    totalSlugsFetched,
    prePortfolio,
    {
      skippedNonBinary,
      skippedNoHistory,
      skippedEntryBand,
      skippedEndWithinDays,
      skippedLiqVolGamma,
      skippedNoWinner,
      skippedMaxPositions,
    },
    rows
  )

  const metrics = metricsFromHistorical(rows, options.initialCapital, counters, equitySteps, options.bondParams)

  return { trades: rows, metrics }
}
