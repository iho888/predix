import { z } from "zod"
import type { HighProbabilityBondParams, StrategyConfig, StoredStrategyConfig, StrategyTemplateId } from "@/types"

const strategyConditionZ = z.object({
  outcome: z.enum(["YES", "NO", "LONG", "SHORT"]),
  minProbability: z.number().min(0).max(1).optional(),
  maxProbability: z.number().min(0).max(1).optional(),
  minVolume: z.number().min(0).optional(),
  trend: z.enum(["rising", "falling", "stable", "any"]).optional(),
  minLiquidity: z.number().min(0).optional(),
})

const exitZ = z.object({
  takeProfitPct: z.number().min(0.01).max(10),
  stopLossPct: z.number().min(0.01).max(1),
  maxHoldingDays: z.number().int().min(1).optional(),
})

const strategyConfigZ = z.object({
  entryConditions: strategyConditionZ,
  exitConditions: exitZ,
  positionSizePct: z.number().min(1).max(100),
  maxOpenPositions: z.number().int().min(1).max(20),
  minOdds: z.number().optional(),
  maxOdds: z.number().optional(),
  endWithinDays: z.number().int().min(1).max(3650).nullable().optional(),
})

const highProbabilityBondParamsZ = z
  .object({
    minPrice: z.number().min(0).max(1),
    maxPrice: z.number().min(0).max(1).nullable(),
    minLiquidityNum: z.number().min(0),
    minVolumeNum: z.number().min(0),
    endWithinDays: z.number().int().min(1).max(3650).nullable(),
    takeProfitPct: z.number().min(0.01).max(10),
    stopLossPct: z.number().min(0.01).max(1),
    maxHoldingDays: z.number().int().min(1).max(3650).nullable(),
    positionSizePct: z.number().min(1).max(100),
    maxOpenPositions: z.number().int().min(1).max(20),
  })
  .refine((d) => d.maxPrice == null || d.minPrice <= d.maxPrice, {
    message: "min price must be <= max price when max is set",
    path: ["minPrice"],
  })

export const storedStrategyConfigZ = z.discriminatedUnion("templateId", [
  z.object({
    templateId: z.literal("high_probability_bond"),
    version: z.number().int().optional(),
    params: highProbabilityBondParamsZ,
  }),
  z.object({
    templateId: z.literal("classic_backtest"),
    version: z.number().int().optional(),
    params: strategyConfigZ,
  }),
])

/** For API POST: accept legacy `polywatch_bond` in the request body. */
export function normalizeIncomingStrategyConfigBody(body: unknown): void {
  if (body == null || typeof body !== "object" || !("config" in body)) return
  const wrap = body as { config: unknown }
  const c = wrap.config
  if (c && typeof c === "object" && (c as { templateId?: string }).templateId === "polywatch_bond") {
    wrap.config = { ...(c as Record<string, unknown>), templateId: "high_probability_bond" }
  }
}

function normalizeTemplateIdInRaw(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object" || !("templateId" in raw)) return raw
  const o = raw as Record<string, unknown>
  if (o.templateId === "polywatch_bond") {
    return { ...o, templateId: "high_probability_bond" }
  }
  return raw
}

export function highProbabilityBondToStrategyConfig(p: HighProbabilityBondParams): StrategyConfig {
  return {
    entryConditions: {
      outcome: "YES",
      minProbability: p.minPrice,
      maxProbability: p.maxPrice ?? undefined,
      minVolume: p.minVolumeNum,
      minLiquidity: p.minLiquidityNum,
      trend: "any",
    },
    exitConditions: {
      takeProfitPct: p.takeProfitPct,
      stopLossPct: p.stopLossPct,
      maxHoldingDays: p.maxHoldingDays ?? undefined,
    },
    positionSizePct: p.positionSizePct,
    maxOpenPositions: p.maxOpenPositions,
    endWithinDays: p.endWithinDays,
  }
}

/** @deprecated use highProbabilityBondToStrategyConfig */
export const polywatchBondToStrategyConfig = highProbabilityBondToStrategyConfig

export function storedConfigToStrategyConfig(stored: StoredStrategyConfig): StrategyConfig {
  if (stored.templateId === "high_probability_bond") {
    return highProbabilityBondToStrategyConfig(stored.params)
  }
  return stored.params
}

/**
 * DB JSON may be legacy: plain `StrategyConfig` with no `templateId`, or `polywatch_bond` id.
 */
export function parseStoredStrategyConfig(raw: unknown):
  | { ok: true; data: StoredStrategyConfig }
  | { ok: false; error: string } {
  const withUnion = storedStrategyConfigZ.safeParse(normalizeTemplateIdInRaw(raw))
  if (withUnion.success) return { ok: true, data: withUnion.data as StoredStrategyConfig }

  if (raw && typeof raw === "object" && "entryConditions" in raw && !("templateId" in raw)) {
    const leg = strategyConfigZ.safeParse(raw)
    if (leg.success) {
      return {
        ok: true,
        data: { templateId: "classic_backtest" as const, version: 1, params: leg.data as StrategyConfig },
      }
    }
  }
  return { ok: false, error: "Invalid strategy configuration" }
}

export const defaultHighProbabilityBondParams: HighProbabilityBondParams = {
  minPrice: 0.92,
  maxPrice: null,
  minLiquidityNum: 1000,
  minVolumeNum: 5000,
  endWithinDays: 30,
  takeProfitPct: 0.2,
  stopLossPct: 0.15,
  maxHoldingDays: 30,
  positionSizePct: 10,
  maxOpenPositions: 5,
}

/** @deprecated */
export const defaultPolyWatchBondParams = defaultHighProbabilityBondParams

const defaultClassicParams: StrategyConfig = {
  entryConditions: {
    outcome: "YES",
    minProbability: 0.3,
    maxProbability: 0.7,
    minVolume: 10_000,
    trend: "any",
  },
  exitConditions: { takeProfitPct: 0.2, stopLossPct: 0.15, maxHoldingDays: 30 },
  positionSizePct: 10,
  maxOpenPositions: 5,
}

export function defaultStoredConfig(templateId: StrategyTemplateId): StoredStrategyConfig {
  if (templateId === "high_probability_bond") {
    return { templateId, version: 1, params: { ...defaultHighProbabilityBondParams } }
  }
  return { templateId, version: 1, params: { ...defaultClassicParams } }
}

export const STRATEGY_TEMPLATES: {
  id: StrategyTemplateId
  label: string
  shortLabel: string
  description: string
}[] = [
  {
    id: "high_probability_bond",
    label: "High-probability bond",
    shortLabel: "High-prob bond",
    description:
      "Near-par leading outcome, liquidity and volume floors, optional resolution window. For live screening and backtests on synthetic data.",
  },
  {
    id: "classic_backtest",
    label: "Classic backtest",
    shortLabel: "Classic",
    description: "Full control over entry, exit, trend, and both YES/NO or LONG/SHORT style outcomes.",
  },
]
