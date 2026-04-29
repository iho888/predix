"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { HighProbabilityBondParams, StrategyConfig, StoredStrategyConfig, StrategyTemplateId } from "@/types"
import { STRATEGY_TEMPLATES } from "@/lib/strategy-templates"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type PickerProps = {
  templateId: StrategyTemplateId
  onSelectTemplate: (id: StrategyTemplateId) => void
}

export function TemplatePicker({ templateId, onSelectTemplate }: PickerProps) {
  return (
    <div className="space-y-3">
      <Label>Strategy template</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        {STRATEGY_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelectTemplate(t.id)}
            className={`text-left rounded-lg border p-4 transition-colors ${
              templateId === t.id
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border hover:border-muted-foreground/30"
            }`}
          >
            <p className="font-medium text-sm">{t.label}</p>
            <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function num(v: string): number | undefined {
  if (v === "" || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export function HighProbabilityBondFormFields({ params, onChange }: { params: HighProbabilityBondParams; onChange: (p: HighProbabilityBondParams) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Price &amp; liquidity (leading outcome)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Min price (0–1)</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={params.minPrice}
              onChange={(e) => onChange({ ...params, minPrice: num(e.target.value) ?? 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max price (optional, empty = no cap)</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={params.maxPrice == null ? "" : params.maxPrice}
              onChange={(e) => {
                const raw = e.target.value
                onChange({ ...params, maxPrice: raw === "" ? null : (num(raw) ?? null) })
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Min liquidity (Num)</Label>
            <Input
              type="number"
              min={0}
              value={params.minLiquidityNum}
              onChange={(e) => onChange({ ...params, minLiquidityNum: num(e.target.value) ?? 0 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Min volume (Num)</Label>
            <Input
              type="number"
              min={0}
              value={params.minVolumeNum}
              onChange={(e) => onChange({ ...params, minVolumeNum: num(e.target.value) ?? 0 })}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>End within (days) — only markets resolving in this window (empty = any)</Label>
            <Input
              type="number"
              min={1}
              value={params.endWithinDays == null ? "" : params.endWithinDays}
              onChange={(e) => {
                const raw = e.target.value
                onChange({ ...params, endWithinDays: raw === "" ? null : (parseInt(raw, 10) || null) })
              }}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Backtest exits &amp; size</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Take profit % (decimal, e.g. 0.2 = 20%)</Label>
            <Input
              type="number"
              min={0.01}
              step={0.01}
              value={params.takeProfitPct}
              onChange={(e) => onChange({ ...params, takeProfitPct: num(e.target.value) ?? 0.01 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Stop loss %</Label>
            <Input
              type="number"
              min={0.01}
              step={0.01}
              value={params.stopLossPct}
              onChange={(e) => onChange({ ...params, stopLossPct: num(e.target.value) ?? 0.01 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max holding days (empty = no limit)</Label>
            <Input
              type="number"
              min={1}
              value={params.maxHoldingDays == null ? "" : params.maxHoldingDays}
              onChange={(e) => {
                const raw = e.target.value
                onChange({ ...params, maxHoldingDays: raw === "" ? null : (parseInt(raw, 10) || null) })
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>Position size (% of capital)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={params.positionSizePct}
              onChange={(e) => onChange({ ...params, positionSizePct: num(e.target.value) ?? 1 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max open positions</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={params.maxOpenPositions}
              onChange={(e) => onChange({ ...params, maxOpenPositions: parseInt(e.target.value, 10) || 1 })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function updateEntry(cfg: StrategyConfig, key: string, value: unknown): StrategyConfig {
  return { ...cfg, entryConditions: { ...cfg.entryConditions, [key]: value } }
}

function updateExit(cfg: StrategyConfig, key: string, value: unknown): StrategyConfig {
  return { ...cfg, exitConditions: { ...cfg.exitConditions, [key]: value } }
}

export function ClassicBacktestFormFields({ params, onChange }: { params: StrategyConfig; onChange: (p: StrategyConfig) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Entry</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Trade side</Label>
            <Select
              value={params.entryConditions.outcome}
              onValueChange={(v) => onChange(updateEntry(params, "outcome", v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="YES">YES</SelectItem>
                <SelectItem value="NO">NO</SelectItem>
                <SelectItem value="LONG">LONG</SelectItem>
                <SelectItem value="SHORT">SHORT</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Min probability</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={params.entryConditions.minProbability ?? ""}
              onChange={(e) => onChange(updateEntry(params, "minProbability", num(e.target.value)))}
            />
          </div>
          <div className="space-y-2">
            <Label>Max probability</Label>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={params.entryConditions.maxProbability ?? ""}
              onChange={(e) => onChange(updateEntry(params, "maxProbability", num(e.target.value)))}
            />
          </div>
          <div className="space-y-2">
            <Label>Min 24h volume ($)</Label>
            <Input
              type="number"
              min={0}
              value={params.entryConditions.minVolume ?? ""}
              onChange={(e) => onChange(updateEntry(params, "minVolume", num(e.target.value)))}
            />
          </div>
          <div className="space-y-2">
            <Label>Trend</Label>
            <Select
              value={params.entryConditions.trend ?? "any"}
              onValueChange={(v) => onChange(updateEntry(params, "trend", v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="rising">Rising</SelectItem>
                <SelectItem value="falling">Falling</SelectItem>
                <SelectItem value="stable">Stable</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Min liquidity ($)</Label>
            <Input
              type="number"
              min={0}
              value={params.entryConditions.minLiquidity ?? ""}
              onChange={(e) => onChange(updateEntry(params, "minLiquidity", num(e.target.value)))}
            />
          </div>
          <div className="space-y-2">
            <Label>End within days (empty = any)</Label>
            <Input
              type="number"
              min={1}
              value={params.endWithinDays == null || params.endWithinDays === undefined ? "" : params.endWithinDays}
              onChange={(e) => {
                const raw = e.target.value
                onChange({
                  ...params,
                  endWithinDays: raw === "" ? null : parseInt(raw, 10) || null,
                })
              }}
            />
          </div>
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Exit</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Take profit %</Label>
            <Input
              type="number"
              min={0.01}
              max={10}
              step={0.01}
              value={params.exitConditions.takeProfitPct}
              onChange={(e) => onChange(updateExit(params, "takeProfitPct", num(e.target.value) ?? 0.01))}
            />
          </div>
          <div className="space-y-2">
            <Label>Stop loss %</Label>
            <Input
              type="number"
              min={0.01}
              max={1}
              step={0.01}
              value={params.exitConditions.stopLossPct}
              onChange={(e) => onChange(updateExit(params, "stopLossPct", num(e.target.value) ?? 0.01))}
            />
          </div>
          <div className="space-y-2">
            <Label>Max holding days</Label>
            <Input
              type="number"
              min={1}
              value={params.exitConditions.maxHoldingDays ?? ""}
              onChange={(e) => onChange(updateExit(params, "maxHoldingDays", parseInt(e.target.value, 10) || undefined))}
            />
          </div>
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Size</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Position size %</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={params.positionSizePct}
              onChange={(e) => onChange({ ...params, positionSizePct: num(e.target.value) ?? 1 })}
            />
          </div>
          <div className="space-y-2">
            <Label>Max open positions</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={params.maxOpenPositions}
              onChange={(e) => onChange({ ...params, maxOpenPositions: parseInt(e.target.value, 10) || 1 })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export function TemplateParamsForm({
  stored,
  onChange,
}: {
  stored: StoredStrategyConfig
  onChange: (next: StoredStrategyConfig) => void
}) {
  if (stored.templateId === "high_probability_bond") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">High-probability bond parameters</CardTitle>
          <CardDescription>Leading outcome price band, liquidity and volume floors, and optional resolution window. Also used for Live apply against current Polymarket data.</CardDescription>
        </CardHeader>
        <CardContent>
          <HighProbabilityBondFormFields
            params={stored.params}
            onChange={(p) => onChange({ templateId: "high_probability_bond", version: 1, params: p })}
          />
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Classic backtest parameters</CardTitle>
        <CardDescription>Direct control over the simulation engine, including trend and both sides of the book.</CardDescription>
      </CardHeader>
      <CardContent>
        <ClassicBacktestFormFields
          params={stored.params}
          onChange={(p) => onChange({ templateId: "classic_backtest", version: 1, params: p })}
        />
      </CardContent>
    </Card>
  )
}
