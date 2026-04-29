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
}

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

export interface UserSession {
  id: string
  email: string
  name: string
  subscriptionStatus: SubscriptionStatus
  trialEndsAt: string
  trialDaysLeft: number
}
