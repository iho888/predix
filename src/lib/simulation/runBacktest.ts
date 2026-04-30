import type { BacktestResult, MarketSide, PricePoint, SimulatedTrade, SimulationMarket } from "@/lib/polymarket/types"
import { emptyOrderBook, getPriceHistory } from "@/lib/polymarket/clob"
import type { StrategyFn } from "@/lib/strategies/types"

const MIN_POINTS = 5

function exitPriceForSide(side: MarketSide, winningOutcomeIndex: 0 | 1): number {
  if (side === "YES") return winningOutcomeIndex === 0 ? 1 : 0
  return winningOutcomeIndex === 1 ? 1 : 0
}

/**
 * Single-trade MVP: walk price history; first non-null signal enters and holds to resolution.
 * Outcome 0 = YES, outcome 1 = NO (binary Gamma / CLOB ordering).
 *
 * @throws Error for invalid market state or unusable history (caller maps to HTTP 400).
 */
export async function runSingleTradeSimulation(
  market: SimulationMarket,
  strategy: StrategyFn
): Promise<BacktestResult> {
  if (!market.closed) {
    throw new Error("Market is not closed — pick a resolved market for backtesting.")
  }
  if (market.winningOutcomeIndex == null) {
    throw new Error(
      "Could not infer a binary winner from Gamma outcome prices. Try another resolved market."
    )
  }

  const yesTokenId = market.clobTokenIds[0]
  let history = await getPriceHistory(yesTokenId, "max", 720)
  if (history.length < MIN_POINTS) {
    history = await getPriceHistory(yesTokenId, "max", 60)
  }

  if (history.length < MIN_POINTS) {
    throw new Error(
      `Not enough price history (${history.length} points). Try a market with more CLOB history.`
    )
  }

  const trades: SimulatedTrade[] = []
  const winIdx = market.winningOutcomeIndex

  for (let i = MIN_POINTS; i <= history.length; i++) {
    const window = history.slice(0, i)
    const last = window[window.length - 1]
    const yesPx = last.p

    const ctx = {
      priceHistory: window,
      orderBook: emptyOrderBook(yesPx),
      currentPrice: yesPx,
      marketQuestion: market.question,
    }

    const signal = strategy(ctx)
    if (signal.side == null || signal.size <= 0) continue

    const entryPrice = signal.side === "YES" ? yesPx : 1 - yesPx
    const exitPrice = exitPriceForSide(signal.side, winIdx)
    const pnl = (exitPrice - entryPrice) * signal.size
    const won = pnl > 0

    trades.push({
      timestamp: last.t,
      side: signal.side,
      entryPrice,
      exitPrice,
      pnl,
      won,
      reason: signal.reason,
    })
    break
  }

  if (trades.length === 0) {
    return {
      trades: [],
      totalPnL: 0,
      winRate: null,
      maxDrawdown: 0,
      historyPoints: history.length,
    }
  }

  const totalPnL = trades.reduce((s, t) => s + t.pnl, 0)
  const winRate = trades.filter((t) => t.won).length / trades.length

  return {
    trades,
    totalPnL,
    winRate,
    maxDrawdown: 0,
    historyPoints: history.length,
  }
}

export type { PricePoint }
