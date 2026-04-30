"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LineChart, Loader2 } from "lucide-react"
import { strategyRegistry } from "@/lib/strategies/registry"

type SearchHit = { slug: string; question: string }

type SimulatedTrade = {
  timestamp: number
  side: "YES" | "NO"
  entryPrice: number
  exitPrice: number
  pnl: number
  won: boolean
  reason: string
}

type BacktestResult = {
  trades: SimulatedTrade[]
  totalPnL: number
  winRate: number | null
  maxDrawdown: number
  historyPoints: number
}

type SimulateResponse = {
  strategyId: string
  strategyName: string
  market: {
    slug: string
    question: string
    closed: boolean
    outcomes: [string, string]
    winningOutcomeIndex: 0 | 1 | null
  }
  backtest: BacktestResult
}

export default function SimulatePage() {
  const [slug, setSlug] = useState("")
  const [strategyId, setStrategyId] = useState(strategyRegistry[0]?.id ?? "")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<SimulateResponse | null>(null)

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setHits([])
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/polymarket/simulate?search=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      if (res.ok && Array.isArray(data.hits)) setHits(data.hits)
      else setHits([])
    } catch {
      setHits([])
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => runSearch(slug), 350)
    return () => clearTimeout(t)
  }, [slug, runSearch])

  async function runSimulation() {
    setError("")
    setResult(null)
    if (!slug.trim()) {
      setError("Enter a market slug")
      return
    }
    if (!strategyId) {
      setError("Pick a strategy")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/polymarket/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug.trim(), strategyId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setResult(data as SimulateResponse)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <LineChart className="w-8 h-8" />
          Simulate
        </h1>
        <p className="text-muted-foreground mt-1">
          Backtest a <strong>resolved</strong> Polymarket market using public Gamma + CLOB history. Strategy registry
          only — single trade to resolution (MVP).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run backtest</CardTitle>
          <CardDescription>
            Paste a market slug (from the Polymarket URL) or type to search closed markets. Outcome 0 is treated as
            YES, outcome 1 as NO for signals and P&amp;L.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="slug">Market slug</Label>
            <Input
              id="slug"
              placeholder="e.g. lol-wlg-tpx-2026-04-28-game2"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
            />
            {searching && <p className="text-xs text-muted-foreground">Searching…</p>}
            {hits.length > 0 && (
              <ul className="rounded-md border max-h-40 overflow-y-auto text-sm">
                {hits.map((h) => (
                  <li key={h.slug}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 border-b border-border/40 last:border-0"
                      onClick={() => {
                        setSlug(h.slug)
                        setHits([])
                      }}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{h.slug}</span>
                      <span className="block text-foreground line-clamp-1">{h.question}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <Label>Strategy (registry)</Label>
            <Select value={strategyId} onValueChange={setStrategyId}>
              <SelectTrigger>
                <SelectValue placeholder="Select strategy" />
              </SelectTrigger>
              <SelectContent>
                {strategyRegistry.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {strategyRegistry.find((s) => s.id === strategyId) && (
              <p className="text-xs text-muted-foreground">
                {strategyRegistry.find((s) => s.id === strategyId)?.description}
              </p>
            )}
          </div>
          <Button onClick={runSimulation} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running…
              </>
            ) : (
              "Run simulation"
            )}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {result.strategyName} · {result.market.slug} · {result.backtest.historyPoints} price points
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">{result.market.question}</p>
              <p className="text-muted-foreground mt-1">
                Resolved winner:{" "}
                {result.market.winningOutcomeIndex != null
                  ? `${result.market.outcomes[result.market.winningOutcomeIndex]} (index ${result.market.winningOutcomeIndex})`
                  : "—"}
              </p>
            </div>
            {result.backtest.trades.length === 0 ? (
              <p className="text-muted-foreground">
                No trade: the strategy never produced a signal on this history (or history was too short after
                checks).
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Net P&amp;L (per unit size)</p>
                    <p className="text-lg font-semibold tabular-nums">{result.backtest.totalPnL.toFixed(4)}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Win</p>
                    <p className="text-lg font-semibold">{result.backtest.trades[0]?.won ? "Yes" : "No"}</p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">Win rate</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {result.backtest.winRate != null ? `${(result.backtest.winRate * 100).toFixed(0)}%` : "—"}
                    </p>
                  </div>
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-2">Side</th>
                        <th className="p-2">Entry</th>
                        <th className="p-2">Exit</th>
                        <th className="p-2">P&amp;L</th>
                        <th className="p-2 min-w-[180px]">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.backtest.trades.map((t, i) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="p-2">{t.side}</td>
                          <td className="p-2 tabular-nums">{t.entryPrice.toFixed(4)}</td>
                          <td className="p-2 tabular-nums">{t.exitPrice.toFixed(4)}</td>
                          <td className="p-2 tabular-nums">{t.pnl.toFixed(4)}</td>
                          <td className="p-2 text-muted-foreground">{t.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
