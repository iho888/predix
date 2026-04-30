"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, PlayCircle, ChevronUp, Eye } from "lucide-react"
import type { SimulationMetrics } from "@/types"
import { formatCurrency, formatPct } from "@/lib/utils"
import { DataStatusBar } from "@/components/simulations/DataStatusBar"

interface Strategy {
  id: string
  name: string
  platform: string
  config?: { templateId?: string }
}

type MetricsWithRun = SimulationMetrics & { runKind?: "closed_batch" | "historical" }

interface Simulation {
  id: string
  name: string
  status: string
  platform: string
  initialCapital: number
  createdAt: string
  metrics: MetricsWithRun | null
  strategy: { name: string; platform: string }
}

function isBondPolymarketStrategy(s: Strategy): boolean {
  return s.platform === "polymarket" && s.config?.templateId === "high_probability_bond"
}

function localInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SimulationsPage() {
  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [showForm, setShowForm] = useState(false)
  const [runTab, setRunTab] = useState<"batch" | "historical" | "db">("db")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")

  const defaultHistoricalRange = useMemo(() => {
    const end = new Date()
    end.setMinutes(0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - 90)
    start.setHours(0, 0, 0, 0)
    return { start: localInputValue(start), end: localInputValue(end) }
  }, [])

  const [form, setForm] = useState({
    strategyId: "",
    name: "",
    initialCapital: 1000,
    maxMarkets: 25,
    histStart: defaultHistoricalRange.start,
    histEnd: defaultHistoricalRange.end,
    maxMarketsHistorical: 25,
  })

  const eligibleStrategies = strategies.filter(isBondPolymarketStrategy)

  async function fetchData() {
    const [simsRes, stratsRes] = await Promise.all([fetch("/api/simulations"), fetch("/api/strategies")])
    if (simsRes.ok) setSimulations(await simsRes.json())
    if (stratsRes.ok) setStrategies(await stratsRes.json())
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleRunBatch(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/polymarket/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: form.strategyId,
          name: form.name,
          initialCapital: form.initialCapital,
          maxMarkets: form.maxMarkets,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setShowForm(false)
      fetchData()
      showToast("Simulation completed successfully")
    } catch {
      setError("Failed to run simulation")
    } finally {
      setLoading(false)
    }
  }

  async function handleRunHistorical(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const startDate = new Date(form.histStart)
      const endDate = new Date(form.histEnd)
      const res = await fetch("/api/polymarket/simulate-historical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: form.strategyId,
          name: form.name,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          initialCapital: form.initialCapital,
          maxMarkets: form.maxMarketsHistorical,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setShowForm(false)
      fetchData()
      showToast("Historical simulation completed successfully")
    } catch {
      setError("Failed to run simulation")
    } finally {
      setLoading(false)
    }
  }

  async function handleRunDbReplay(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const startDate = new Date(form.histStart)
      const endDate = new Date(form.histEnd)
      const res = await fetch("/api/simulations/db-replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyId: form.strategyId,
          name: form.name,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          initialCapital: form.initialCapital,
          maxMarkets: form.maxMarketsHistorical,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setShowForm(false)
      fetchData()
      showToast("DB replay simulation completed successfully")
    } catch {
      setError("Failed to run DB replay simulation")
    } finally {
      setLoading(false)
    }
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Simulations</h1>
          <p className="text-muted-foreground mt-1">
            Polymarket paper runs using your saved High-probability bond strategy: a fast closed batch, or a dated
            historical dry-run with TP/SL and portfolio limits.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <ChevronUp className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "Run simulation"}
        </Button>
      </div>

      <DataStatusBar onSynced={() => fetchData()} />

      {eligibleStrategies.length === 0 && (
        <div className="p-4 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          You need a saved <strong className="font-medium">Polymarket</strong> strategy using the{" "}
          <strong className="font-medium">High-probability bond</strong> template.{" "}
          <Link href="/dashboard/strategies" className="underline">
            Create or edit a strategy
          </Link>
          .
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Run simulation</CardTitle>
            <CardDescription>
              DB replay runs entirely against stored data. Legacy modes still work (live API).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
            <Tabs value={runTab} onValueChange={(v) => setRunTab(v as "batch" | "historical" | "db")}>
              <TabsList className="grid w-full max-w-lg grid-cols-3">
                <TabsTrigger value="batch">Closed batch</TabsTrigger>
                <TabsTrigger value="historical">Historical dry-run</TabsTrigger>
                <TabsTrigger value="db">DB replay</TabsTrigger>
              </TabsList>

              <TabsContent value="batch" className="mt-4 space-y-4">
                <p className="text-sm text-muted-foreground">
                  Fetches up to 25 resolved markets (<code className="text-xs">closed=true</code>).{" "}
                  <code className="text-xs">endWithinDays</code> is <strong className="font-medium">not</strong> applied.
                  Entry = earliest CLOB point; exit = resolution payout from first-candle side.
                </p>
                <form onSubmit={handleRunBatch} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation name</Label>
                      <Input
                        placeholder="e.g. Closed bond batch"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Strategy</Label>
                      <Select value={form.strategyId} onValueChange={(v) => setForm({ ...form, strategyId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select bond strategy…" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleStrategies.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Markets (max 25)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={25}
                        value={form.maxMarkets}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            maxMarkets: Math.min(25, Math.max(1, parseInt(e.target.value, 10) || 1)),
                          })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Initial capital ($)</Label>
                      <Input
                        type="number"
                        min={100}
                        value={form.initialCapital}
                        onChange={(e) => setForm({ ...form, initialCapital: parseFloat(e.target.value) })}
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={loading || !form.strategyId || eligibleStrategies.length === 0}>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {loading ? "Running…" : "Run closed batch"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="historical" className="mt-4 space-y-4">
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-200/90 space-y-2">
                  <p>
                    Uses <strong className="font-medium">real Gamma + CLOB</strong> history. Liquidity/volume filters use{" "}
                    <strong className="font-medium">current</strong> Gamma fields (not point-in-time at your start date).
                    Large market counts can approach the server time limit (60s).
                  </p>
                  <p className="text-xs text-muted-foreground">
                    End date must be in the past. <code>endWithinDays</code> is evaluated from your simulation start date.
                  </p>
                </div>
                <form onSubmit={handleRunHistorical} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation name</Label>
                      <Input
                        placeholder="e.g. Q1 2025 historical dry-run"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Strategy</Label>
                      <Select value={form.strategyId} onValueChange={(v) => setForm({ ...form, strategyId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select bond strategy…" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleStrategies.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation start (local)</Label>
                      <Input
                        type="datetime-local"
                        value={form.histStart}
                        onChange={(e) => setForm({ ...form, histStart: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Simulation end (local, must be past)</Label>
                      <Input
                        type="datetime-local"
                        value={form.histEnd}
                        onChange={(e) => setForm({ ...form, histEnd: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Markets to fetch (max 100)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={form.maxMarketsHistorical}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            maxMarketsHistorical: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 1)),
                          })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Initial capital ($)</Label>
                      <Input
                        type="number"
                        min={100}
                        value={form.initialCapital}
                        onChange={(e) => setForm({ ...form, initialCapital: parseFloat(e.target.value) })}
                        required
                      />
                    </div>
                  </div>
                  <Button type="submit" disabled={loading || !form.strategyId || eligibleStrategies.length === 0}>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {loading ? "Running…" : "Run historical dry-run"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="db" className="mt-4 space-y-4">
                <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-3 text-sm text-sky-200/90 space-y-2">
                  <p>
                    Runs against your <strong className="font-medium">stored Polymarket database</strong> (no API calls during the run).
                    Large date ranges may take ~10–30s.
                  </p>
                </div>
                <form onSubmit={handleRunDbReplay} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation name</Label>
                      <Input
                        placeholder="e.g. DB replay: last 90d"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Strategy</Label>
                      <Select value={form.strategyId} onValueChange={(v) => setForm({ ...form, strategyId: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select strategy…" />
                        </SelectTrigger>
                        <SelectContent>
                          {strategies.filter((s) => s.platform === "polymarket").map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation start (local)</Label>
                      <Input type="datetime-local" value={form.histStart} onChange={(e) => setForm({ ...form, histStart: e.target.value })} required />
                    </div>
                    <div className="space-y-2">
                      <Label>Simulation end (local, must be past)</Label>
                      <Input type="datetime-local" value={form.histEnd} onChange={(e) => setForm({ ...form, histEnd: e.target.value })} required />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Max markets (1–200)</Label>
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        value={form.maxMarketsHistorical}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            maxMarketsHistorical: Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)),
                          })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Initial capital ($)</Label>
                      <Input
                        type="number"
                        min={100}
                        value={form.initialCapital}
                        onChange={(e) => setForm({ ...form, initialCapital: parseFloat(e.target.value) })}
                        required
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={loading || !form.strategyId}>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {loading ? "Running…" : "Run DB replay"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {simulations.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <PlayCircle className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground mb-4">No simulations yet. Run your first simulation.</p>
            </CardContent>
          </Card>
        ) : (
          simulations.map((sim) => (
            <Card key={sim.id} className="glow-card">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-semibold">{sim.name}</h3>
                      <Badge
                        variant={
                          sim.status === "COMPLETED"
                            ? "success"
                            : sim.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                        }
                        className="text-xs capitalize"
                      >
                        {sim.status.toLowerCase()}
                      </Badge>
                      <Badge variant="outline" className="capitalize text-xs">
                        {sim.platform}
                      </Badge>
                      {sim.metrics?.runKind === "historical" && (
                        <Badge variant="secondary" className="text-xs">
                          Historical
                        </Badge>
                      )}
                      {(sim.metrics as any)?.polymarketMeta?.gammaWinnerField?.toString?.().startsWith("db_") && (
                        <Badge variant="secondary" className="text-xs">
                          DB Replay
                        </Badge>
                      )}
                      {sim.metrics?.runKind === "closed_batch" && (
                        <Badge variant="secondary" className="text-xs">
                          Closed batch
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">
                      Strategy: {sim.strategy.name} · Capital: {formatCurrency(sim.initialCapital)}
                    </p>

                    {sim.metrics && (
                      <div className="flex flex-wrap gap-4 text-xs">
                        <div>
                          <span className="text-muted-foreground">ROI </span>
                          <span
                            className={
                              sim.metrics.roi >= 0 ? "text-green-400 font-medium" : "text-red-400 font-medium"
                            }
                          >
                            {formatPct(sim.metrics.roi)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">P&L </span>
                          <span
                            className={
                              sim.metrics.totalPnL >= 0 ? "text-green-400 font-medium" : "text-red-400 font-medium"
                            }
                          >
                            {formatCurrency(sim.metrics.totalPnL)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Win rate </span>
                          <span className="text-foreground font-medium">{sim.metrics.winRate}%</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Trades </span>
                          <span className="text-foreground font-medium">{sim.metrics.totalTrades}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Sharpe </span>
                          <span className="text-foreground font-medium">{sim.metrics.sharpeRatio}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max DD </span>
                          <span className="text-red-400 font-medium">-{sim.metrics.maxDrawdownPct}%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <Link href={`/dashboard/simulations/${sim.id}`}>
                    <Button variant="ghost" size="icon" className="ml-2">
                      <Eye className="w-4 h-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
