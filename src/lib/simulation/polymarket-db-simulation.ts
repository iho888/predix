import { prisma } from "@/lib/db"
import { randomSimId } from "@/lib/simulation/polymarket-sim-shared"
import type { Prisma } from "@prisma/client"
import type { PolymarketBatchSimulationMetrics, SimulatedTradeRow, StoredStrategyConfig } from "@/types"
import { differenceInDays, format, startOfMonth } from "date-fns"
import { strategyPassesEntry, type DbCandle, type DbMarket } from "./strategy-adapter"

type MarketRow = {
  slug: string
  question: string
  endDate: Date | null
  liquidityNum: number | null
  volumeNum: number | null
  winningOutcomeIndex: number | null
  clobTokenIdsJson: Prisma.JsonValue
}

function pickTokenIdForSide(clobTokenIdsJson: unknown, side: "YES" | "NO"): string | null {
  if (!Array.isArray(clobTokenIdsJson)) return null
  const idx = side === "YES" ? 0 : 1
  const raw = clobTokenIdsJson[idx]
  const s = raw != null ? String(raw).trim() : ""
  return s ? s : null
}

function exitPriceForSide(side: "YES" | "NO", winningOutcomeIndex: 0 | 1): number {
  if (side === "YES") return winningOutcomeIndex === 0 ? 1 : 0
  return winningOutcomeIndex === 1 ? 1 : 0
}

type OpenPos = {
  slug: string
  side: "YES" | "NO"
  entryTime: Date
  entryPrice: number
  sizeUsd: number
  shares: number
  tokenId: string
  marketQuestion: string
  endDate: Date
  winningOutcomeIndex: 0 | 1
}

function buildMetrics(
  trades: Extract<SimulatedTradeRow, { source: "polymarket" }>[],
  initialCapital: number,
  equitySteps: { t: number; equity: number }[],
  batch: PolymarketBatchSimulationMetrics["batch"]
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

  let durSum = 0
  for (const t of trades) {
    if (t.historyFirstT != null && t.historyExitT != null) {
      durSum += differenceInDays(new Date(t.historyExitT * 1000), new Date(t.historyFirstT * 1000))
    }
  }
  const avgTradeDurationDays = n > 0 ? Math.round((durSum / n) * 10) / 10 : 0

  return {
    totalTrades: n,
    winningTrades: winners.length,
    losingTrades: n - winners.length,
    winRate: winRatePct,
    totalPnL,
    totalPnLPct: Math.round((totalPnL / initialCapital) * 10000) / 100,
    avgWin: winners.length > 0 ? Math.round((grossProfit / winners.length) * 100) / 100 : 0,
    avgLoss: losers.length > 0 ? Math.round((grossLoss / losers.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round((maxDrawdown / initialCapital) * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    finalCapital,
    initialCapital,
    roi: Math.round(((finalCapital - initialCapital) / initialCapital) * 10000) / 100,
    avgTradeDurationDays,
    bestTrade: winners.length > 0 ? Math.round(Math.max(...winners.map((t) => t.pnl)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map((t) => t.pnl)) * 100) / 100 : 0,
    equityCurve,
    monthlyReturns,
    platformBreakdown: {
      polymarket: { trades: n, pnl: totalPnL, winRate: winRatePct },
    },
    batch,
    runKind: "historical",
    polymarketMeta: {
      entryRule: "clob_first_candle_after_start",
      endWithinDaysApplied: true,
      gammaWinnerField: "db_winningOutcomeIndex",
      gammaLiquidityVolumePointInTime: false,
    },
  }
}

export async function runPolymarketDbSimulation(options: {
  strategyConfig: StoredStrategyConfig
  simStart: Date
  simEnd: Date
  initialCapital: number
  maxMarkets: number
}): Promise<{ metrics: PolymarketBatchSimulationMetrics; trades: SimulatedTradeRow[] }> {
  const maxMarkets = Math.min(200, Math.max(1, Math.floor(options.maxMarkets)))

  const markets = await prisma.polymarketMarket.findMany({
    where: {
      closed: true,
      endDate: { gte: options.simStart, lte: options.simEnd },
      winningOutcomeIndex: { not: null },
    },
    orderBy: [{ endDate: "asc" }, { volumeNum: "desc" }],
    take: maxMarkets,
    select: {
      slug: true,
      question: true,
      endDate: true,
      liquidityNum: true,
      volumeNum: true,
      winningOutcomeIndex: true,
      clobTokenIdsJson: true,
    },
  })

  const usable = markets.filter(
    (m): m is MarketRow & { endDate: Date; winningOutcomeIndex: number } => m.endDate != null && m.winningOutcomeIndex != null
  )

  if (usable.length === 0) {
    const emptyMetrics = buildMetrics([], options.initialCapital, [{ t: Math.floor(options.simStart.getTime() / 1000), equity: options.initialCapital }], {
      totalSlugsFetched: 0,
      matchedMarkets: 0,
      skippedNonBinary: 0,
      skippedNoMatch: 0,
      skippedNoHistory: 0,
      skippedEntryBand: 0,
      totalTrades: 0,
      winningTrades: 0,
      matchRate: 0,
    })
    return { metrics: emptyMetrics, trades: [] }
  }

  const slugs = usable.map((m) => m.slug)
  const maxEnd = usable.reduce((mx, m) => (m.endDate.getTime() > mx.getTime() ? m.endDate : mx), usable[0]!.endDate)

  const candles = await prisma.polymarketPriceCandle.findMany({
    where: {
      marketSlug: { in: slugs },
      timestamp: { gte: options.simStart, lte: maxEnd },
    },
    orderBy: [{ timestamp: "asc" }],
    select: { marketSlug: true, timestamp: true, yesPrice: true },
  })

  const marketBySlug = new Map<string, (MarketRow & { endDate: Date; winningOutcomeIndex: number })>()
  for (const m of usable) marketBySlug.set(m.slug, m)

  const candlesByTime = new Map<number, { slug: string; candle: DbCandle }[]>()
  for (const c of candles) {
    const t = c.timestamp.getTime()
    const entry = { slug: c.marketSlug, candle: { timestamp: c.timestamp, yesPrice: c.yesPrice } }
    const list = candlesByTime.get(t)
    if (list) list.push(entry)
    else candlesByTime.set(t, [entry])
  }

  const times = Array.from(candlesByTime.keys()).sort((a, b) => a - b)

  const open = new Map<string, OpenPos>()
  const executed: Extract<SimulatedTradeRow, { source: "polymarket" }>[] = []
  let cash = options.initialCapital
  const equitySteps: { t: number; equity: number }[] = []

  if (times.length > 0) equitySteps.push({ t: Math.floor(times[0]! / 1000), equity: cash })

  let skippedNoHistory = 0

  const positionSizePct =
    options.strategyConfig.templateId === "high_probability_bond"
      ? options.strategyConfig.params.positionSizePct
      : options.strategyConfig.params.positionSizePct
  const maxOpenPositions =
    options.strategyConfig.templateId === "high_probability_bond"
      ? options.strategyConfig.params.maxOpenPositions
      : options.strategyConfig.params.maxOpenPositions
  const takeProfitPct =
    options.strategyConfig.templateId === "high_probability_bond"
      ? options.strategyConfig.params.takeProfitPct
      : options.strategyConfig.params.exitConditions.takeProfitPct
  const stopLossPct =
    options.strategyConfig.templateId === "high_probability_bond"
      ? options.strategyConfig.params.stopLossPct
      : options.strategyConfig.params.exitConditions.stopLossPct
  const maxHoldingDays =
    options.strategyConfig.templateId === "high_probability_bond"
      ? options.strategyConfig.params.maxHoldingDays
      : options.strategyConfig.params.exitConditions.maxHoldingDays

  for (const timeKey of times) {
    const currentTime = new Date(timeKey)
    const current = candlesByTime.get(timeKey)!

    // exits
    for (const [slug, pos] of open) {
      const m = marketBySlug.get(slug)
      if (!m) continue

      const tick = current.find((x) => x.slug === slug)
      const currentYes = tick?.candle.yesPrice
      const currentPrice = currentYes == null ? null : pos.side === "YES" ? currentYes : 1 - currentYes

      let shouldExit = false
      let exitReason: Extract<SimulatedTradeRow, { source: "polymarket" }>["exitReason"] = "resolution"
      let exitPrice: number | null = null

      if (currentTime.getTime() >= m.endDate.getTime()) {
        shouldExit = true
        exitReason = "resolution"
        exitPrice = exitPriceForSide(pos.side, m.winningOutcomeIndex as 0 | 1)
      } else if (currentPrice != null) {
        const pnlPct = (currentPrice - pos.entryPrice) / pos.entryPrice
        if (pnlPct >= takeProfitPct) {
          shouldExit = true
          exitReason = "take_profit"
          exitPrice = currentPrice
        } else if (pnlPct <= -stopLossPct) {
          shouldExit = true
          exitReason = "stop_loss"
          exitPrice = currentPrice
        } else if (maxHoldingDays != null && differenceInDays(currentTime, pos.entryTime) >= maxHoldingDays) {
          shouldExit = true
          exitReason = "max_holding"
          exitPrice = currentPrice
        }
      }

      if (!shouldExit || exitPrice == null) continue

      const pnl = Math.round(pos.shares * (exitPrice - pos.entryPrice) * 100) / 100
      cash += pos.sizeUsd + pnl
      equitySteps.push({ t: Math.floor(currentTime.getTime() / 1000), equity: Math.round(cash * 100) / 100 })

      executed.push({
        source: "polymarket",
        id: randomSimId(),
        slug,
        question: pos.marketQuestion,
        tokenId: pos.tokenId,
        side: pos.side,
        entryPrice: Math.round(pos.entryPrice * 1e6) / 1e6,
        exitPrice: Math.round(exitPrice * 1e6) / 1e6,
        positionSizeUsd: Math.round(pos.sizeUsd * 100) / 100,
        pnl,
        won: pnl > 0,
        entryRule: "clob_first_candle_after_start",
        historyFirstT: Math.floor(pos.entryTime.getTime() / 1000),
        historyExitT: Math.floor(currentTime.getTime() / 1000),
        exitReason,
        polymarketRun: "historical",
      })

      open.delete(slug)
    }

    // entries
    if (open.size < maxOpenPositions) {
      for (const { slug, candle } of current) {
        if (open.size >= maxOpenPositions) break
        if (open.has(slug)) continue
        const m = marketBySlug.get(slug)
        if (!m) continue
        if (currentTime.getTime() > m.endDate.getTime()) continue

        const market: DbMarket = {
          slug: m.slug,
          question: m.question,
          endDate: m.endDate,
          liquidityNum: m.liquidityNum,
          volumeNum: m.volumeNum,
        }

        const dec = strategyPassesEntry(candle, market, options.strategyConfig, currentTime)
        if (!dec.ok) continue

        const positionSizeUsd = Math.round(Math.max(5, (cash * positionSizePct) / 100) * 100) / 100
        if (positionSizeUsd > cash) continue

        const entryPrice = dec.side === "YES" ? candle.yesPrice : 1 - candle.yesPrice
        const tokenId = pickTokenIdForSide(m.clobTokenIdsJson, dec.side)
        if (!tokenId) continue

        open.set(slug, {
          slug,
          side: dec.side,
          entryTime: currentTime,
          entryPrice,
          sizeUsd: positionSizeUsd,
          shares: positionSizeUsd / entryPrice,
          tokenId,
          marketQuestion: m.question,
          endDate: m.endDate,
          winningOutcomeIndex: m.winningOutcomeIndex as 0 | 1,
        })
        cash -= positionSizeUsd
      }
    }
  }

  // For DB replay we only persist CLOSED trades; any unclosed is ignored.
  const batch = {
    totalSlugsFetched: slugs.length,
    matchedMarkets: slugs.length,
    skippedNonBinary: 0,
    skippedNoMatch: 0,
    skippedNoHistory,
    skippedEntryBand: 0,
    totalTrades: executed.length,
    winningTrades: executed.filter((t) => t.won).length,
    matchRate: slugs.length === 0 ? 0 : Math.round((slugs.length / slugs.length) * 10000) / 100,
  }

  const metrics = buildMetrics(executed, options.initialCapital, equitySteps.length ? equitySteps : [{ t: Math.floor(options.simStart.getTime() / 1000), equity: options.initialCapital }], batch)

  return { metrics, trades: executed }
}

