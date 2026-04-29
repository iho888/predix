import { Badge } from "@/components/ui/badge"
import { STRATEGY_TEMPLATES } from "@/lib/strategy-templates"
import type { HighProbabilityBondParams, StoredStrategyConfig, StrategyConfig } from "@/types"

function templateShortLabel(id: string): string {
  if (id === "polywatch_bond") return "High-prob bond"
  return STRATEGY_TEMPLATES.find((t) => t.id === id)?.shortLabel ?? id
}

export function isStoredStrategyConfig(c: unknown): c is StoredStrategyConfig {
  if (typeof c !== "object" || c === null || !("templateId" in c) || !("params" in c)) return false
  const id = (c as { templateId: string }).templateId
  return id === "high_probability_bond" || id === "polywatch_bond" || id === "classic_backtest"
}

export function StrategyConfigSummary({ config }: { config: unknown }) {
  if (!isStoredStrategyConfig(config)) {
    return (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Legacy format (run a new simulation after re-saving as a template, or keep using as-is).</span>
      </div>
    )
  }

  const tid = config.templateId as string
  if (tid === "high_probability_bond" || tid === "polywatch_bond") {
    const p = config.params as HighProbabilityBondParams
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Price:{" "}
          <span className="text-foreground font-medium">
            {p.minPrice.toFixed(2)}
            {p.maxPrice != null ? `–${p.maxPrice.toFixed(2)}` : "+"}
          </span>
        </span>
        <span>
          Liq / vol:{" "}
          <span className="text-foreground font-medium">
            {p.minLiquidityNum.toLocaleString()} / {p.minVolumeNum.toLocaleString()}
          </span>
        </span>
        {p.endWithinDays != null && (
          <span>
            Resolves in: <span className="text-foreground font-medium">{p.endWithinDays}d</span>
          </span>
        )}
        <span>
          TP/SL:{" "}
          <span className="text-green-400 font-medium">{(p.takeProfitPct * 100).toFixed(0)}%</span> /{" "}
          <span className="text-red-400 font-medium">{(p.stopLossPct * 100).toFixed(0)}%</span>
        </span>
        <span>
          Size: <span className="text-foreground font-medium">{p.positionSizePct}%</span> · max{" "}
          {p.maxOpenPositions} pos
        </span>
      </div>
    )
  }

  const p = config.params as StrategyConfig
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        Side: <span className="text-foreground font-medium">{p.entryConditions.outcome}</span>
      </span>
      <span>
        Prob:{" "}
        <span className="text-foreground font-medium">
          {((p.entryConditions.minProbability ?? 0) * 100).toFixed(0)}–
          {((p.entryConditions.maxProbability ?? 1) * 100).toFixed(0)}%
        </span>
      </span>
      <span>
        TP/SL:{" "}
        <span className="text-green-400 font-medium">{(p.exitConditions.takeProfitPct * 100).toFixed(0)}%</span> /{" "}
        <span className="text-red-400 font-medium">{(p.exitConditions.stopLossPct * 100).toFixed(0)}%</span>
      </span>
      <span>
        Size: <span className="text-foreground font-medium">{p.positionSizePct}%</span> · max {p.maxOpenPositions}
      </span>
    </div>
  )
}

export function TemplateBadge({ config }: { config: unknown }) {
  if (!isStoredStrategyConfig(config)) {
    return <Badge variant="secondary">Legacy</Badge>
  }
  return <Badge variant="outline">{templateShortLabel(config.templateId)}</Badge>
}
