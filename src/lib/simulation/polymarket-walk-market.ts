import type { PricePoint } from "@/lib/polymarket/types"
import type { HighProbabilityBondParams } from "@/types"

export type WalkExitReason = "take_profit" | "stop_loss" | "max_holding" | "resolution"

function exitPriceForSide(side: "YES" | "NO", winningOutcomeIndex: 0 | 1): number {
  if (side === "YES") return winningOutcomeIndex === 0 ? 1 : 0
  return winningOutcomeIndex === 1 ? 1 : 0
}

/**
 * Walk YES-token price series after entry: TP / SL / max holding vs resolution payout.
 * `history` must be sorted ascending by `t`. `entryUnixTs` is the entry candle time.
 */
export function walkMarket(
  history: PricePoint[],
  side: "YES" | "NO",
  entryPrice: number,
  winningOutcomeIndex: 0 | 1,
  params: HighProbabilityBondParams,
  entryUnixTs: number
): {
  exitPrice: number
  exitReason: WalkExitReason
  exitTs: number
} {
  const entryIdx = history.findIndex((pt) => pt.t >= entryUnixTs)
  if (entryIdx < 0) {
    const last = history[history.length - 1]!
    return {
      exitPrice: exitPriceForSide(side, winningOutcomeIndex),
      exitReason: "resolution",
      exitTs: last.t,
    }
  }

  const takeProfit = params.takeProfitPct
  const stopLoss = params.stopLossPct
  const maxHoldSec =
    params.maxHoldingDays != null && params.maxHoldingDays > 0 ? params.maxHoldingDays * 86400 : null

  for (let i = entryIdx + 1; i < history.length; i++) {
    const pt = history[i]!
    const currentPrice = side === "YES" ? pt.p : 1 - pt.p
    const pnlPct = (currentPrice - entryPrice) / entryPrice

    if (pnlPct >= takeProfit) {
      return { exitPrice: currentPrice, exitReason: "take_profit", exitTs: pt.t }
    }
    if (pnlPct <= -stopLoss) {
      return { exitPrice: currentPrice, exitReason: "stop_loss", exitTs: pt.t }
    }
    if (maxHoldSec != null && pt.t - entryUnixTs >= maxHoldSec) {
      return { exitPrice: currentPrice, exitReason: "max_holding", exitTs: pt.t }
    }
  }

  const last = history[history.length - 1]!
  return {
    exitPrice: exitPriceForSide(side, winningOutcomeIndex),
    exitReason: "resolution",
    exitTs: last.t,
  }
}
