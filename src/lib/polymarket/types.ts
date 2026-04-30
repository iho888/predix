/** Binary side for registry strategies (outcome 0 = YES, outcome 1 = NO). */
export type MarketSide = "YES" | "NO"

export interface PricePoint {
  /** Unix time in seconds (CLOB API). */
  t: number
  /** Implied probability 0–1 for the primary (first) outcome token. */
  p: number
}

export interface OrderBookLevel {
  price: number
  size: number
}

export interface OrderBook {
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  midpoint: number
  spread: number
}

export interface SignalResult {
  side: MarketSide | null
  price: number
  size: number
  reason: string
}

export interface SimulatedTrade {
  timestamp: number
  side: MarketSide
  entryPrice: number
  exitPrice: number
  pnl: number
  won: boolean
  reason: string
}

export interface BacktestResult {
  trades: SimulatedTrade[]
  totalPnL: number
  winRate: number | null
  maxDrawdown: number
  historyPoints: number
}

/** Normalized Gamma market for simulation (binary outcomes only). */
export interface SimulationMarket {
  slug: string
  question: string
  conditionId: string
  closed: boolean
  /** Two labels, e.g. Yes / No — strategies map index 0 → YES, 1 → NO. */
  outcomes: [string, string]
  clobTokenIds: [string, string]
  outcomePrices: [number, number]
  /** Resolved winning index 0 or 1; null if not determined from Gamma. */
  winningOutcomeIndex: 0 | 1 | null
}
