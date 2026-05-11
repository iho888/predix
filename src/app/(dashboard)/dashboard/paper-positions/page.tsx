"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, RefreshCw, TrendingUp, TrendingDown, Clock } from "lucide-react"

type Position = {
  id: string
  strategyName: string
  marketSlug: string
  marketQuestion: string
  side: "YES" | "NO"
  status: "OPEN" | "CLOSED" | "RESOLVED"
  endDate: string
  entryTime: string
  entryMid: number
  entryFillPrice: number
  positionSizeUsd: number
  shares: number
  exitTime: string | null
  exitMid: number | null
  exitFillPrice: number | null
  exitReason: string | null
  pnlUsd: number | null
  urlPath: string
}

type Stats = {
  totalPositions: number
  openCount: number
  closedCount: number
  wins: number
  losses: number
  winRate: number | null
  totalPnL: number
  avgPnL: number | null
  profitFactor: number | null
  totalDeployedUsd: number
}

type ApiResponse = {
  generatedAt: string
  stats: Stats
  positions: Position[]
}

function fmtDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

function fmtRelDays(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  return fmtDate(iso)
}

function fmtRemainingDays(iso: string, now = Date.now()): string {
  const days = Math.floor((new Date(iso).getTime() - now) / 86400000)
  if (days < 0) return "past resolution"
  if (days === 0) return "resolves today"
  return `${days}d to resolve`
}

function fmtUsd(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2)
}

function fmtPct(n: number | null): string {
  if (n == null) return "—"
  return (n * 100).toFixed(1) + "%"
}

export default function PaperPositionsPage() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/paper-positions", { cache: "no-store" })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error ?? `Request failed: ${res.status}`)
      }
      const json = (await res.json()) as ApiResponse
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const open = data?.positions.filter((p) => p.status === "OPEN") ?? []
  const closed = data?.positions.filter((p) => p.status !== "OPEN") ?? []

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Paper trades</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live paper-trading state for your fade strategies. The daily cron at 05:00 UTC opens
            new entries and closes positions at the configured max-hold window.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Open positions" value={String(data.stats.openCount)} sub={fmtUsd(data.stats.totalDeployedUsd) + " deployed"} />
            <StatCard label="Closed positions" value={String(data.stats.closedCount)} sub={`${data.stats.wins}W / ${data.stats.losses}L`} />
            <StatCard label="Win rate" value={fmtPct(data.stats.winRate)} sub={data.stats.closedCount > 0 ? "since first exit" : "no closed trades yet"} />
            <StatCard
              label="Realized PnL"
              value={fmtUsd(data.stats.totalPnL)}
              sub={data.stats.profitFactor != null ? `PF ${data.stats.profitFactor.toFixed(2)}` : ""}
              tone={data.stats.totalPnL > 0 ? "good" : data.stats.totalPnL < 0 ? "bad" : "neutral"}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Open positions ({open.length})
              </CardTitle>
              <CardDescription>
                Held positions, awaiting maxhold exit or market resolution.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {open.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No open positions. The cron runs daily at 05:00 UTC and may add new ones if signals fire.
                </p>
              ) : (
                <PositionTable rows={open} mode="open" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Closed positions ({closed.length})
              </CardTitle>
              <CardDescription>
                History — exited at the configured max-hold window or at market resolution.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {closed.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No closed positions yet. First exit fires once an open position reaches its max-hold age.
                </p>
              ) : (
                <PositionTable rows={closed} mode="closed" />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "neutral" }) {
  const color = tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-rose-500" : ""
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold mt-1 ${color}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function PositionTable({ rows, mode }: { rows: Position[]; mode: "open" | "closed" }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="text-left py-2 pr-4">Market</th>
            <th className="text-right py-2 px-2">Side</th>
            <th className="text-right py-2 px-2">Entry</th>
            <th className="text-right py-2 px-2">Size</th>
            {mode === "open" ? (
              <>
                <th className="text-right py-2 px-2">Age</th>
                <th className="text-right py-2 px-2">Resolves</th>
              </>
            ) : (
              <>
                <th className="text-right py-2 px-2">Exit</th>
                <th className="text-right py-2 px-2">Reason</th>
                <th className="text-right py-2 px-2">PnL</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b hover:bg-muted/40">
              <td className="py-2 pr-4">
                <a
                  href={p.urlPath}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium leading-tight hover:underline inline-flex items-center gap-1 group"
                  title="Open on Polymarket"
                >
                  {p.marketQuestion || p.marketSlug}
                  <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100 shrink-0" />
                </a>
                <p className="text-xs text-muted-foreground">{p.strategyName}</p>
              </td>
              <td className="text-right py-2 px-2">
                <Badge variant={p.side === "YES" ? "default" : "secondary"} className="font-mono text-xs">{p.side}</Badge>
              </td>
              <td className="text-right py-2 px-2 font-mono text-xs">
                {p.entryFillPrice.toFixed(3)}
                <p className="text-muted-foreground">{fmtDate(p.entryTime)}</p>
              </td>
              <td className="text-right py-2 px-2 font-mono text-xs">{fmtUsd(p.positionSizeUsd)}</td>
              {mode === "open" ? (
                <>
                  <td className="text-right py-2 px-2 text-xs">{fmtRelDays(p.entryTime)}</td>
                  <td className="text-right py-2 px-2 text-xs text-muted-foreground">{fmtRemainingDays(p.endDate)}</td>
                </>
              ) : (
                <>
                  <td className="text-right py-2 px-2 font-mono text-xs">
                    {p.exitFillPrice?.toFixed(3) ?? "—"}
                    <p className="text-muted-foreground">{p.exitTime ? fmtDate(p.exitTime) : "—"}</p>
                  </td>
                  <td className="text-right py-2 px-2 text-xs text-muted-foreground">{p.exitReason ?? "—"}</td>
                  <td className={`text-right py-2 px-2 font-mono text-sm ${(p.pnlUsd ?? 0) > 0 ? "text-emerald-500" : (p.pnlUsd ?? 0) < 0 ? "text-rose-500" : ""}`}>
                    {p.pnlUsd != null ? fmtUsd(p.pnlUsd) : "—"}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
