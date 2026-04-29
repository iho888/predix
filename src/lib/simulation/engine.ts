import { MarketTick, Trade, SimulationMetrics, StrategyConfig, Platform } from "@/types"
import { generatePolymarketTicks } from "./markets/polymarket"
import { generateKaishiTicks } from "./markets/kaishi"
import { addDays, differenceInDays, format, startOfMonth } from "date-fns"

function generateId(): string {
  return Math.random().toString(36).substring(2, 11)
}

function conditionMet(tick: MarketTick, config: StrategyConfig, currentTime: Date): boolean {
  const c = config.entryConditions
  const price = c.outcome === "YES" || c.outcome === "LONG" ? tick.yesPrice : tick.noPrice

  if (c.minProbability !== undefined && price < c.minProbability) return false
  if (c.maxProbability !== undefined && price > c.maxProbability) return false
  if (c.minVolume !== undefined && tick.volume24h < c.minVolume) return false
  if (c.minLiquidity !== undefined && tick.liquidity < c.minLiquidity) return false
  if (c.trend && c.trend !== "any" && tick.trend !== c.trend) return false

  const d = config.endWithinDays
  if (d != null && d > 0) {
    const res = tick.resolveDate
    if (res < currentTime) return false
    if (res > addDays(currentTime, d)) return false
  }

  return true
}

export function runSimulation(
  config: StrategyConfig,
  platform: Platform,
  startDate: Date,
  endDate: Date,
  initialCapital: number
): { metrics: SimulationMetrics; trades: Trade[] } {
  // Generate market data
  let ticks: MarketTick[] = []
  if (platform === "polymarket" || platform === "generic") {
    ticks = ticks.concat(generatePolymarketTicks(startDate, endDate))
  }
  if (platform === "kaishi" || platform === "generic") {
    ticks = ticks.concat(generateKaishiTicks(startDate, endDate))
  }
  ticks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const trades: Trade[] = []
  const openPositions: Map<string, Trade> = new Map()
  let capital = initialCapital
  const equityHistory: { date: Date; equity: number }[] = []

  // Deduplicate ticks by marketId+timestamp
  const uniqueTicks = ticks.filter((t, i) => {
    return !ticks.slice(0, i).some(
      (p) => p.marketId === t.marketId && p.timestamp.getTime() === t.timestamp.getTime()
    )
  })

  // Group ticks by timestamp for simulation stepping
  const ticksByTime = new Map<number, MarketTick[]>()
  for (const tick of uniqueTicks) {
    const key = tick.timestamp.getTime()
    if (!ticksByTime.has(key)) ticksByTime.set(key, [])
    ticksByTime.get(key)!.push(tick)
  }

  const sortedTimes = Array.from(ticksByTime.keys()).sort()

  for (const timeKey of sortedTimes) {
    const currentTicks = ticksByTime.get(timeKey)!
    const currentTime = new Date(timeKey)

    // Check exits for open positions
    for (const [posId, trade] of openPositions) {
      const marketTick = currentTicks.find((t) => t.marketId === trade.marketId)
      if (!marketTick) continue

      const currentPrice =
        trade.outcome === "YES" ? marketTick.yesPrice : marketTick.noPrice
      const pnlPct = (currentPrice - trade.entryPrice) / trade.entryPrice

      let shouldExit = false
      let exitReason: Trade["exitReason"]

      if (pnlPct >= config.exitConditions.takeProfitPct) {
        shouldExit = true
        exitReason = "take_profit"
      } else if (pnlPct <= -config.exitConditions.stopLossPct) {
        shouldExit = true
        exitReason = "stop_loss"
      } else if (
        config.exitConditions.maxHoldingDays &&
        differenceInDays(currentTime, trade.entryDate) >= config.exitConditions.maxHoldingDays
      ) {
        shouldExit = true
        exitReason = "max_holding"
      }

      if (shouldExit) {
        const pnl = trade.size * pnlPct
        const closedTrade: Trade = {
          ...trade,
          exitDate: currentTime,
          exitPrice: currentPrice,
          pnl,
          pnlPct,
          status: "CLOSED",
          exitReason,
        }
        trades.push(closedTrade)
        capital += trade.size + pnl
        openPositions.delete(posId)
      }
    }

    // Check entries
    if (openPositions.size < config.maxOpenPositions) {
      for (const tick of currentTicks) {
        if (openPositions.size >= config.maxOpenPositions) break

        // Don't open a second position in the same market
        const alreadyOpen = Array.from(openPositions.values()).some(
          (t) => t.marketId === tick.marketId
        )
        if (alreadyOpen) continue

        if (conditionMet(tick, config, currentTime)) {
          const positionSize = capital * (config.positionSizePct / 100)
          if (positionSize < 5) continue // minimum $5

          const entryPrice =
            config.entryConditions.outcome === "YES" || config.entryConditions.outcome === "LONG"
              ? tick.yesPrice
              : tick.noPrice

          const trade: Trade = {
            id: generateId(),
            marketId: tick.marketId,
            marketTitle: tick.title,
            platform: tick.platform,
            entryDate: currentTime,
            outcome: config.entryConditions.outcome === "LONG" ? "YES" : config.entryConditions.outcome as "YES" | "NO",
            entryPrice,
            size: positionSize,
            status: "OPEN",
          }

          capital -= positionSize
          openPositions.set(trade.id, trade)
        }
      }
    }

    // Snapshot equity
    let unrealizedPnl = 0
    for (const [, trade] of openPositions) {
      const tick = currentTicks.find((t) => t.marketId === trade.marketId)
      if (tick) {
        const currentPrice = trade.outcome === "YES" ? tick.yesPrice : tick.noPrice
        unrealizedPnl += trade.size * ((currentPrice - trade.entryPrice) / trade.entryPrice)
      }
    }
    equityHistory.push({ date: currentTime, equity: capital + unrealizedPnl })
  }

  // Close any remaining open positions at last price
  for (const [, trade] of openPositions) {
    trades.push({ ...trade, status: "OPEN" })
  }

  return {
    metrics: calculateMetrics(trades, initialCapital, capital, equityHistory),
    trades,
  }
}

function calculateMetrics(
  trades: Trade[],
  initialCapital: number,
  finalCash: number,
  equityHistory: { date: Date; equity: number }[]
): SimulationMetrics {
  const closed = trades.filter((t) => t.status === "CLOSED")
  const winners = closed.filter((t) => (t.pnl ?? 0) > 0)
  const losers = closed.filter((t) => (t.pnl ?? 0) <= 0)

  const totalPnL = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const finalCapital = finalCash + trades.filter((t) => t.status === "OPEN").reduce((s, t) => s + t.size, 0)

  const grossProfit = winners.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + (t.pnl ?? 0), 0))

  // Max drawdown
  let peak = initialCapital
  let maxDrawdown = 0
  for (const { equity } of equityHistory) {
    if (equity > peak) peak = equity
    const dd = peak - equity
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  // Sharpe ratio (simplified, daily returns)
  const dailyReturns: number[] = []
  for (let i = 1; i < equityHistory.length; i++) {
    const r = (equityHistory[i].equity - equityHistory[i - 1].equity) / equityHistory[i - 1].equity
    dailyReturns.push(r)
  }
  const avgReturn = dailyReturns.reduce((s, r) => s + r, 0) / (dailyReturns.length || 1)
  const stdReturn = Math.sqrt(
    dailyReturns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / (dailyReturns.length || 1)
  )
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0

  // Equity curve (sampled)
  const equityCurve = equityHistory
    .filter((_, i) => i % Math.max(1, Math.floor(equityHistory.length / 100)) === 0)
    .map(({ date, equity }) => ({
      date: format(date, "yyyy-MM-dd"),
      equity: Math.round(equity * 100) / 100,
      drawdown: 0,
    }))

  // Monthly returns
  const monthlyMap = new Map<string, number[]>()
  for (const t of closed) {
    if (!t.exitDate) continue
    const key = format(startOfMonth(t.exitDate), "yyyy-MM")
    if (!monthlyMap.has(key)) monthlyMap.set(key, [])
    monthlyMap.get(key)!.push(t.pnl ?? 0)
  }
  const monthlyReturns = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, pnls]) => {
      const ret = pnls.reduce((s, p) => s + p, 0)
      return { month, return: Math.round(ret * 100) / 100, returnPct: Math.round((ret / initialCapital) * 10000) / 100 }
    })

  // Platform breakdown
  const platformMap = new Map<string, { trades: Trade[]; pnl: number }>()
  for (const t of closed) {
    const p = t.platform
    if (!platformMap.has(p)) platformMap.set(p, { trades: [], pnl: 0 })
    platformMap.get(p)!.trades.push(t)
    platformMap.get(p)!.pnl += t.pnl ?? 0
  }
  const platformBreakdown: SimulationMetrics["platformBreakdown"] = {}
  for (const [p, data] of platformMap) {
    const wins = data.trades.filter((t) => (t.pnl ?? 0) > 0).length
    platformBreakdown[p] = {
      trades: data.trades.length,
      pnl: Math.round(data.pnl * 100) / 100,
      winRate: data.trades.length > 0 ? Math.round((wins / data.trades.length) * 10000) / 100 : 0,
    }
  }

  const avgDuration =
    closed.length > 0
      ? closed.reduce((s, t) => s + (t.exitDate ? differenceInDays(t.exitDate, t.entryDate) : 0), 0) / closed.length
      : 0

  return {
    totalTrades: closed.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate: closed.length > 0 ? Math.round((winners.length / closed.length) * 10000) / 100 : 0,
    totalPnL: Math.round(totalPnL * 100) / 100,
    totalPnLPct: Math.round((totalPnL / initialCapital) * 10000) / 100,
    avgWin: winners.length > 0 ? Math.round((grossProfit / winners.length) * 100) / 100 : 0,
    avgLoss: losers.length > 0 ? Math.round((grossLoss / losers.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : 0,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    maxDrawdownPct: Math.round((maxDrawdown / initialCapital) * 10000) / 100,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    finalCapital: Math.round(finalCapital * 100) / 100,
    initialCapital,
    roi: Math.round(((finalCapital - initialCapital) / initialCapital) * 10000) / 100,
    avgTradeDurationDays: Math.round(avgDuration * 10) / 10,
    bestTrade: winners.length > 0 ? Math.round(Math.max(...winners.map((t) => t.pnl ?? 0)) * 100) / 100 : 0,
    worstTrade: losers.length > 0 ? Math.round(Math.min(...losers.map((t) => t.pnl ?? 0)) * 100) / 100 : 0,
    equityCurve,
    monthlyReturns,
    platformBreakdown,
  }
}
