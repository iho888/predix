import type { StoredStrategyConfig, HighProbabilityBondParams, FadeFavoriteParams, StrategyConfig } from "@/types"
import { addDays } from "date-fns"

export type DbCandle = {
  timestamp: Date
  yesPrice: number
}

export type DbMarket = {
  slug: string
  question: string
  endDate: Date
  liquidityNum: number | null
  volumeNum: number | null
}

export type EntryDecision =
  | { ok: false }
  | { ok: true; side: "YES" | "NO"; entryRule: "clob_first_candle_after_start" }

function priceBandOk(price: number, min: number, max: number | null): boolean {
  if (!Number.isFinite(price)) return false
  if (price < min) return false
  if (max != null && price > max) return false
  return true
}

function endWithinDaysOk(endDate: Date, now: Date, days: number | null): boolean {
  if (days == null) return true
  if (days <= 0) return true
  if (endDate.getTime() < now.getTime()) return false
  return endDate.getTime() <= addDays(now, days).getTime()
}

function bondEntry(candle: DbCandle, market: DbMarket, params: HighProbabilityBondParams, now: Date): EntryDecision {
  const yesPrice = candle.yesPrice
  const noPrice = 1 - yesPrice
  const leading = yesPrice >= noPrice ? { side: "YES" as const, price: yesPrice } : { side: "NO" as const, price: noPrice }

  if (!priceBandOk(leading.price, params.minPrice, params.maxPrice)) return { ok: false }
  if (market.liquidityNum != null && market.liquidityNum < params.minLiquidityNum) return { ok: false }
  if (market.volumeNum != null && market.volumeNum < params.minVolumeNum) return { ok: false }
  if (!endWithinDaysOk(market.endDate, now, params.endWithinDays)) return { ok: false }

  return { ok: true, side: leading.side, entryRule: "clob_first_candle_after_start" }
}

function classicEntry(candle: DbCandle, market: DbMarket, params: StrategyConfig, now: Date): EntryDecision {
  const c = params.entryConditions
  const yesPrice = candle.yesPrice
  const noPrice = 1 - yesPrice
  const price = c.outcome === "YES" || c.outcome === "LONG" ? yesPrice : noPrice
  const side: "YES" | "NO" = c.outcome === "YES" || c.outcome === "LONG" ? "YES" : "NO"

  if (c.minProbability != null && price < c.minProbability) return { ok: false }
  if (c.maxProbability != null && price > c.maxProbability) return { ok: false }
  if (c.minLiquidity != null && (market.liquidityNum ?? 0) < c.minLiquidity) return { ok: false }
  if (c.minVolume != null && (market.volumeNum ?? 0) < c.minVolume) return { ok: false }

  if (!endWithinDaysOk(market.endDate, now, params.endWithinDays ?? null)) return { ok: false }

  return { ok: true, side, entryRule: "clob_first_candle_after_start" }
}

function fadeFavoriteEntry(candle: DbCandle, market: DbMarket, params: FadeFavoriteParams, now: Date): EntryDecision {
  const yes = candle.yesPrice
  if (!Number.isFinite(yes) || yes <= 0 || yes >= 1) return { ok: false }
  // Asymmetric edge per scripts/calibrate.cjs (2026-05-10): only fade when YES
  // is the leader. The mirror trade (YES bet when NO leads) was a losing bucket.
  if (yes < params.leaderMinPrice || yes > params.leaderMaxPrice) return { ok: false }

  if (market.liquidityNum != null && market.liquidityNum < params.minLiquidityNum) return { ok: false }
  if (market.volumeNum != null && market.volumeNum < params.minVolumeNum) return { ok: false }

  // TTR window
  const ttrMs = market.endDate.getTime() - now.getTime()
  if (ttrMs <= 0) return { ok: false }
  const ttrDays = ttrMs / 86400000
  if (ttrDays < params.minTtrDays) return { ok: false }
  if (params.maxTtrDays != null && ttrDays > params.maxTtrDays) return { ok: false }

  // Always bet NO — fade the YES leader.
  return { ok: true, side: "NO", entryRule: "clob_first_candle_after_start" }
}

export function strategyPassesEntry(
  candle: DbCandle,
  market: DbMarket,
  config: StoredStrategyConfig,
  currentTime: Date
): EntryDecision {
  if (config.templateId === "high_probability_bond" || config.templateId === "resolution_sniper") {
    return bondEntry(candle, market, config.params, currentTime)
  }
  if (config.templateId === "fade_favorite") {
    return fadeFavoriteEntry(candle, market, config.params, currentTime)
  }
  return classicEntry(candle, market, config.params, currentTime)
}

