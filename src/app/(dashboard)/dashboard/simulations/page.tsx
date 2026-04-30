"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Plus, PlayCircle, ChevronUp, Eye } from "lucide-react"
import { SimulationMetrics } from "@/types"
import { formatCurrency, formatPct } from "@/lib/utils"
import { PolymarketDryRunPanel } from "@/components/simulations/PolymarketDryRunPanel"

interface Strategy {
  id: string
  name: string
  platform: string
}
interface Simulation {
  id: string
  name: string
  status: string
  platform: string
  initialCapital: number
  createdAt: string
  metrics: SimulationMetrics | null
  strategy: { name: string; platform: string }
}

function SimulationsContent() {
  const searchParams = useSearchParams()
  const [simulations, setSimulations] = useState<Simulation[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [showForm, setShowForm] = useState(false)
  const [runTab, setRunTab] = useState<"synthetic" | "polymarket">("synthetic")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")
  const [form, setForm] = useState({
    strategyId: "",
    name: "",
    startDate: "2024-01-01",
    endDate: "2024-06-30",
    initialCapital: 1000,
  })

  useEffect(() => {
    if (searchParams.get("tab") === "polymarket") {
      setRunTab("polymarket")
      setShowForm(true)
    }
  }, [searchParams])

  async function fetchData() {
    const [simsRes, stratsRes] = await Promise.all([fetch("/api/simulations"), fetch("/api/strategies")])
    if (simsRes.ok) setSimulations(await simsRes.json())
    if (stratsRes.ok) setStrategies(await stratsRes.json())
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleRun(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
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
            Backtest saved strategies on synthetic data, or run a Polymarket dry run (public APIs, no orders).
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <ChevronUp className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "Run simulation"}
        </Button>
      </div>

      {strategies.length === 0 && (
        <div className="p-4 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          You need at least one strategy before running a synthetic simulation.{" "}
          <Link href="/dashboard/strategies" className="underline">
            Create a strategy
          </Link>
          . Polymarket dry run uses the separate strategy registry and does not require a saved strategy.
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Run simulation</CardTitle>
            <CardDescription>Choose synthetic backtest (saved strategy) or Polymarket paper replay.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={runTab} onValueChange={(v) => setRunTab(v as "synthetic" | "polymarket")}>
              <TabsList className="grid w-full max-w-md grid-cols-2">
                <TabsTrigger value="synthetic">Synthetic data</TabsTrigger>
                <TabsTrigger value="polymarket">Polymarket dry run</TabsTrigger>
              </TabsList>
              <TabsContent value="synthetic" className="mt-4">
                {error && runTab === "synthetic" && (
                  <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    {error}
                  </div>
                )}
                <form onSubmit={handleRun} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Simulation name</Label>
                      <Input
                        placeholder="e.g. Q1 2024 backtest"
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
                          {strategies.map((s) => (
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
                      <Label>Start date</Label>
                      <Input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>End date</Label>
                      <Input
                        type="date"
                        value={form.endDate}
                        onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-2">
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

                  <Button type="submit" disabled={loading || !form.strategyId || strategies.length === 0}>
                    <PlayCircle className="w-4 h-4 mr-2" />
                    {loading ? "Running…" : "Run synthetic simulation"}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="polymarket" className="mt-4">
                <PolymarketDryRunPanel />
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
              <p className="text-muted-foreground mb-4">No simulations yet. Run your first backtest.</p>
            </CardContent>
          </Card>
        ) : (
          simulations.map((sim) => (
            <Card key={sim.id} className="glow-card">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
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

export default function SimulationsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-5xl space-y-4 p-6">
          <div className="h-8 w-48 rounded-md bg-muted animate-pulse" />
          <div className="h-32 rounded-md bg-muted animate-pulse" />
        </div>
      }
    >
      <SimulationsContent />
    </Suspense>
  )
}
