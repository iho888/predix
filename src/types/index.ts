export type Platform = "polymarket" | "kaishi" | "generic"
export type SimulationStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED"
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "EXPIRED" | "CANCELLED"

export interface StrategyCondition {
  outcome: "YES" | "NO" | "LONG" | "SHORT"
  minProbability?: number
  maxProbability?: number
  minVolume?: number
  trend?: "rising" | "falling" | "stable" | "any"
  minLiquidity?: number
}

export interface ExitCondition {
  takeProfitPct: number
  stopLossPct: number
  maxHoldingDays?: number
}

export interface StrategyConfig {
  entryConditions: StrategyCondition
  exitConditions: ExitCondition
  positionSizePct: number  // % of capital per trade
  maxOpenPositions: number
  minOdds?: number
  maxOdds?: number
  /** If set, market must resolve on/before this many days after the current tick. */
  endWithinDays?: number | null
}

export type StrategyTemplateId = "high_probability_bond" | "classic_backtest"

export interface HighProbabilityBondParams {
  minPrice: number
  maxPrice: number | null
  minLiquidityNum: number
  minVolumeNum: number
  endWithinDays: number | null
  takeProfitPct: number
  stopLossPct: number
  maxHoldingDays: number | null
  positionSizePct: number
  maxOpenPositions: number
}

/** @deprecated use HighProbabilityBondParams (legacy name) */
export type PolyWatchBondParams = HighProbabilityBondParams

export type StoredStrategyConfig =
  | { templateId: "high_probability_bond"; version?: 1; params: HighProbabilityBondParams }
  | { templateId: "classic_backtest"; version?: 1; params: StrategyConfig }

export interface MarketTick {
  marketId: string
  title: string
  timestamp: Date
  yesPrice: number  // 0-1 probability
  noPrice: number
  volume24h: number
  totalVolume: number
  liquidity: number
  trend: "rising" | "falling" | "stable"
  platform: Platform
  resolveDate: Date
}

export interface Trade {
  id: string
  marketId: string
  marketTitle: string
  platform: Platform
  entryDate: Date
  exitDate?: Date
  outcome: "YES" | "NO"
  entryPrice: number
  exitPrice?: number
  size: number  // dollar amount
  pnl?: number
  pnlPct?: number
  status: "OPEN" | "CLOSED" | "RESOLVED"
  exitReason?: "take_profit" | "stop_loss" | "max_holding" | "resolution"
}

/** Stored in `Simulation.tradesJson` — discriminated by `source` (legacy rows omit `source` = synthetic). */
export type SimulatedTradeRow =
  | ({
      source: "synthetic"
    } & {
      id: string
      marketId: string
      marketTitle: string
      platform: Platform
      entryDate: string
      exitDate?: string
      outcome: "YES" | "NO"
      entryPrice: number
      exitPrice?: number
      size: number
      pnl?: number
      pnlPct?: number
      status: "OPEN" | "CLOSED" | "RESOLVED"
      exitReason?: "take_profit" | "stop_loss" | "max_holding" | "resolution"
    })
  | {
      source: "polymarket"
      id: string
      slug: string
      question: string
      tokenId: string
      side: "YES" | "NO"
      entryPrice: number
      exitPrice: number
      positionSizeUsd: number
      pnl: number
      won: boolean
      entryRule: "clob_first_candle"
      historyFirstT?: number
    }

export interface SimulationMetrics {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  totalPnL: number
  totalPnLPct: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  maxDrawdown: number
  maxDrawdownPct: number
  sharpeRatio: number
  finalCapital: number
  initialCapital: number
  roi: number
  avgTradeDurationDays: number
  bestTrade: number
  worstTrade: number
  equityCurve: { date: string; equity: number; drawdown: number }[]
  monthlyReturns: { month: string; return: number; returnPct: number }[]
  platformBreakdown: Record<string, { trades: number; pnl: number; winRate: number }>
}

export interface PolymarketSimulationBatchCounters {
  totalSlugsFetched: number
  matchedMarkets: number
  skippedNonBinary: number
  skippedNoMatch: number
  skippedNoHistory: number
  skippedEntryBand: number
  totalTrades: number
  winningTrades: number
  matchRate: number
}

export interface PolymarketSimulationBatchMeta {
  entryRule: "clob_first_candle"
  endWithinDaysApplied: false
  gammaWinnerField: string
}

/** `metricsJson` for Polymarket closed batch runs: core metrics + batch diagnostics. */
export type PolymarketBatchSimulationMetrics = SimulationMetrics & {
  batch: PolymarketSimulationBatchCounters
  polymarketMeta: PolymarketSimulationBatchMeta
}

export interface UserSession {
  id: string
  email: string
  name: string
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string
  trialDaysLeft: number
}
