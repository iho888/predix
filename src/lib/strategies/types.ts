import type { OrderBook, PricePoint, SignalResult } from "@/lib/polymarket/types"

export interface StrategyContext {
  priceHistory: PricePoint[]
  orderBook: OrderBook
  /** Implied probability of outcome 0 (YES) from the primary token series. */
  currentPrice: number
  marketQuestion: string
}

export type StrategyFn = (ctx: StrategyContext) => SignalResult

export interface StrategyMeta {
  id: string
  name: string
  description: string
  fn: StrategyFn
}
