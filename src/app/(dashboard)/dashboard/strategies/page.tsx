"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Zap, ChevronDown, ChevronUp } from "lucide-react"
import { StrategyConfig } from "@/types"

interface Strategy {
  id: string
  name: string
  description?: string
  platform: string
  config: StrategyConfig
  createdAt: string
}

const defaultConfig: StrategyConfig = {
  entryConditions: {
    outcome: "YES",
    minProbability: 0.3,
    maxProbability: 0.7,
    minVolume: 10000,
    trend: "any",
  },
  exitConditions: {
    takeProfitPct: 0.2,
    stopLossPct: 0.15,
    maxHoldingDays: 30,
  },
  positionSizePct: 10,
  maxOpenPositions: 5,
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")
  const [form, setForm] = useState({
    name: "",
    description: "",
    platform: "polymarket" as string,
    config: defaultConfig,
  })

  async function fetchStrategies() {
    const res = await fetch("/api/strategies")
    if (res.ok) setStrategies(await res.json())
  }

  useEffect(() => { fetchStrategies() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setShowForm(false)
      setForm({ name: "", description: "", platform: "polymarket", config: defaultConfig })
      fetchStrategies()
      showToast("Strategy created successfully")
    } catch {
      setError("Failed to create strategy")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this strategy?")) return
    await fetch(`/api/strategies/${id}`, { method: "DELETE" })
    fetchStrategies()
    showToast("Strategy deleted")
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  function updateEntry(key: string, value: unknown) {
    setForm((f) => ({
      ...f,
      config: { ...f.config, entryConditions: { ...f.config.entryConditions, [key]: value } },
    }))
  }

  function updateExit(key: string, value: unknown) {
    setForm((f) => ({
      ...f,
      config: { ...f.config, exitConditions: { ...f.config.exitConditions, [key]: value } },
    }))
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Strategies</h1>
          <p className="text-muted-foreground mt-1">Define your trading rules and parameters</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <ChevronUp className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "New Strategy"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create Strategy</CardTitle>
            <CardDescription>Define your entry/exit conditions and risk parameters</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                {error}
              </div>
            )}
            <form onSubmit={handleCreate} className="space-y-6">
              {/* Basic info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Strategy Name</Label>
                  <Input
                    placeholder="e.g. High Value YES Momentum"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="polymarket">Polymarket</SelectItem>
                      <SelectItem value="kaishi">Kaishi</SelectItem>
                      <SelectItem value="generic">Generic (Both)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  placeholder="Brief description of your strategy"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              {/* Entry conditions */}
              <div>
                <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Entry Conditions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Trade Outcome</Label>
                    <Select
                      value={form.config.entryConditions.outcome}
                      onValueChange={(v) => updateEntry("outcome", v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="YES">YES</SelectItem>
                        <SelectItem value="NO">NO</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Min Probability</Label>
                    <Input
                      type="number"
                      min={0} max={1} step={0.01}
                      value={form.config.entryConditions.minProbability ?? ""}
                      onChange={(e) => updateEntry("minProbability", parseFloat(e.target.value))}
                      placeholder="e.g. 0.30"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Probability</Label>
                    <Input
                      type="number"
                      min={0} max={1} step={0.01}
                      value={form.config.entryConditions.maxProbability ?? ""}
                      onChange={(e) => updateEntry("maxProbability", parseFloat(e.target.value))}
                      placeholder="e.g. 0.70"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Min 24h Volume ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.config.entryConditions.minVolume ?? ""}
                      onChange={(e) => updateEntry("minVolume", parseFloat(e.target.value))}
                      placeholder="e.g. 10000"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Trend</Label>
                    <Select
                      value={form.config.entryConditions.trend ?? "any"}
                      onValueChange={(v) => updateEntry("trend", v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any</SelectItem>
                        <SelectItem value="rising">Rising</SelectItem>
                        <SelectItem value="falling">Falling</SelectItem>
                        <SelectItem value="stable">Stable</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Min Liquidity ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      value={form.config.entryConditions.minLiquidity ?? ""}
                      onChange={(e) => updateEntry("minLiquidity", parseFloat(e.target.value))}
                      placeholder="e.g. 5000"
                    />
                  </div>
                </div>
              </div>

              {/* Exit conditions */}
              <div>
                <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Exit Conditions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Take Profit %</Label>
                    <Input
                      type="number"
                      min={0.01} max={10} step={0.01}
                      value={form.config.exitConditions.takeProfitPct}
                      onChange={(e) => updateExit("takeProfitPct", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stop Loss %</Label>
                    <Input
                      type="number"
                      min={0.01} max={1} step={0.01}
                      value={form.config.exitConditions.stopLossPct}
                      onChange={(e) => updateExit("stopLossPct", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Holding Days</Label>
                    <Input
                      type="number"
                      min={1} max={365}
                      value={form.config.exitConditions.maxHoldingDays ?? ""}
                      onChange={(e) => updateExit("maxHoldingDays", parseInt(e.target.value))}
                      placeholder="e.g. 30"
                    />
                  </div>
                </div>
              </div>

              {/* Position sizing */}
              <div>
                <h3 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">Position Sizing</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Position Size (% of capital)</Label>
                    <Input
                      type="number"
                      min={1} max={100}
                      value={form.config.positionSizePct}
                      onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, positionSizePct: parseFloat(e.target.value) } }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Open Positions</Label>
                    <Input
                      type="number"
                      min={1} max={20}
                      value={form.config.maxOpenPositions}
                      onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, maxOpenPositions: parseInt(e.target.value) } }))}
                    />
                  </div>
                </div>
              </div>

              <Button type="submit" disabled={loading}>
                {loading ? "Creating..." : "Create Strategy"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Strategies list */}
      <div className="space-y-3">
        {strategies.length === 0 && !showForm ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Zap className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground mb-4">No strategies yet. Create your first one above.</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> Create Strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          strategies.map((s) => (
            <Card key={s.id} className="glow-card">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{s.name}</h3>
                      <Badge variant="outline" className="capitalize text-xs">{s.platform}</Badge>
                    </div>
                    {s.description && <p className="text-sm text-muted-foreground mb-3">{s.description}</p>}
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Outcome: <span className="text-foreground font-medium">{s.config.entryConditions.outcome}</span></span>
                      <span>Prob: <span className="text-foreground font-medium">{(s.config.entryConditions.minProbability ?? 0) * 100}–{(s.config.entryConditions.maxProbability ?? 1) * 100}%</span></span>
                      <span>TP: <span className="text-green-400 font-medium">{(s.config.exitConditions.takeProfitPct * 100).toFixed(0)}%</span></span>
                      <span>SL: <span className="text-red-400 font-medium">{(s.config.exitConditions.stopLossPct * 100).toFixed(0)}%</span></span>
                      <span>Size: <span className="text-foreground font-medium">{s.config.positionSizePct}%</span></span>
                      <span>Max pos: <span className="text-foreground font-medium">{s.config.maxOpenPositions}</span></span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors ml-4"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
