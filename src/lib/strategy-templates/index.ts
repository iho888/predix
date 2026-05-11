import { z } from "zod"
import type { FadeFavoriteParams, HighProbabilityBondParams, StrategyConfig, StoredStrategyConfig, StrategyTemplateId } from "@/types"

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

const fadeFavoriteParamsZ = z
  .object({
    leaderMinPrice: z.number().min(0).max(1),
    leaderMaxPrice: z.number().min(0).max(1),
    minTtrDays: z.number().int().min(1).max(3650),
    maxTtrDays: z.number().int().min(1).max(3650).nullable(),
    minLiquidityNum: z.number().min(0),
    minVolumeNum: z.number().min(0),
    takeProfitPct: z.number().min(0.01).max(10).nullable(),
    stopLossPct: z.number().min(0.01).max(1).nullable(),
    maxHoldingDays: z.number().int().min(1).max(3650).nullable(),
    // Slippage haircut per leg, e.g. 0.06 = pay 6% above mid on entry,
    // receive 6% below mid on exit. Cap at 50% to prevent absurd values.
    slippagePerLegPct: z.number().min(0).max(0.5).nullable(),
    positionSizePct: z.number().min(0.1).max(100),
    // Allow up to 200 because the strategy's edge is in high-frequency low-size
    // bets — bench v10 used 100 max with 2% size for compounding.
    maxOpenPositions: z.number().int().min(1).max(200),
  })
  .refine((d) => d.leaderMinPrice <= d.leaderMaxPrice, {
    message: "leaderMinPrice must be <= leaderMaxPrice",
    path: ["leaderMinPrice"],
  })
  .refine((d) => d.maxTtrDays == null || d.minTtrDays <= d.maxTtrDays, {
    message: "minTtrDays must be <= maxTtrDays when set",
    path: ["minTtrDays"],
  })

export const storedStrategyConfigZ = z.discriminatedUnion("templateId", [
  z.object({
    templateId: z.literal("high_probability_bond"),
    version: z.number().int().optional(),
    params: highProbabilityBondParamsZ,
  }),
  z.object({
    templateId: z.literal("resolution_sniper"),
    version: z.number().int().optional(),
    params: highProbabilityBondParamsZ,
  }),
  z.object({
    templateId: z.literal("fade_favorite"),
    version: z.number().int().optional(),
    params: fadeFavoriteParamsZ,
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
  if (stored.templateId === "high_probability_bond" || stored.templateId === "resolution_sniper") {
    return highProbabilityBondToStrategyConfig(stored.params)
  }
  if (stored.templateId === "fade_favorite") {
    // Translate to the legacy StrategyConfig shape so legacy code paths can
    // still surface fade strategies in dropdowns. The actual entry/exit logic
    // lives in strategy-adapter.ts (fadeFavoriteEntry).
    return {
      entryConditions: {
        outcome: "NO",
        minProbability: stored.params.leaderMinPrice,
        maxProbability: stored.params.leaderMaxPrice,
        minVolume: stored.params.minVolumeNum,
        minLiquidity: stored.params.minLiquidityNum,
        trend: "any",
      },
      exitConditions: {
        takeProfitPct: stored.params.takeProfitPct ?? 5,
        stopLossPct: stored.params.stopLossPct ?? 1,
        maxHoldingDays: stored.params.maxHoldingDays ?? undefined,
      },
      positionSizePct: stored.params.positionSizePct,
      maxOpenPositions: stored.params.maxOpenPositions,
      endWithinDays: null,
    }
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

// Evidence-based defaults derived from 2024 historic calibration:
// 90%+ markets had 100% resolution accuracy. The 0.97 cap avoids the final
// hours before resolution where price is noise, not signal.
// Hold-to-resolution: wide SL (0.80) and TP (0.50) so exits are rare before endDate.
export const defaultResolutionSniperParams: HighProbabilityBondParams = {
  minPrice: 0.80,
  maxPrice: 0.97,
  minLiquidityNum: 1000,
  minVolumeNum: 5000,
  endWithinDays: null,
  takeProfitPct: 0.50,
  stopLossPct: 0.80,
  maxHoldingDays: null,
  positionSizePct: 5,
  maxOpenPositions: 10,
}

// Fade-the-Favorite v10 defaults — derived 2026-05-10 from:
//   - scripts/calibrate.cjs (3.35M candles → mispricing exists when YES leads at 50-90% with long TTR)
//   - scripts/calibrate-exits.cjs (14d hold maximizes Sharpe vs hold-to-resolution)
//   - scripts/probe-slippage.cjs (real Polymarket spread/depth on in-band markets)
//   - scripts/bench-fade-favorite.cjs v10 result on 2023-2026: 79% win, 65% annualized
//     post-slippage, maxDD 9%, Sharpe 3.95
// Out-of-sample (2025-2026 only) test held up: 81% win, +188% annualized.
export const defaultFadeFavoriteParams: FadeFavoriteParams = {
  leaderMinPrice: 0.50,
  leaderMaxPrice: 0.60,
  minTtrDays: 120,
  maxTtrDays: null,
  minLiquidityNum: 1000,
  minVolumeNum: 25000,
  takeProfitPct: null,
  stopLossPct: null,
  maxHoldingDays: 14,
  slippagePerLegPct: 0.06,
  positionSizePct: 2,
  maxOpenPositions: 20,
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
  if (templateId === "resolution_sniper") {
    return { templateId, version: 1, params: { ...defaultResolutionSniperParams } }
  }
  if (templateId === "fade_favorite") {
    return { templateId, version: 1, params: { ...defaultFadeFavoriteParams } }
  }
  return { templateId: "classic_backtest", version: 1, params: { ...defaultClassicParams } }
}

export const STRATEGY_TEMPLATES: {
  id: StrategyTemplateId
  label: string
  shortLabel: string
  description: string
}[] = [
  {
    id: "fade_favorite",
    label: "Fade-the-Favorite",
    shortLabel: "Fade",
    description:
      "Calibrated 2026-05: bet NO when YES sits in [0.50, 0.60] with TTR ≥ 120 days. Polymarket overpays for far-future certainty; these markets resolve NO ~80% of the time. 14-day hold captures the drift back to reality. Bench: 65% annualized post-slippage, 9% maxDD, Sharpe 3.95.",
  },
  {
    id: "resolution_sniper",
    label: "Resolution Sniper",
    shortLabel: "Sniper",
    description:
      "Evidence-based: 80–97% confidence band. 2024 calibration showed 90%+ markets resolved correctly 100% of the time. Caps at 97% to avoid the final-hour noise zone.",
  },
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
