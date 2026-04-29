"use client"
import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Download, TrendingUp, TrendingDown } from "lucide-react"
import { SimulationMetrics, Trade } from "@/types"
import { formatCurrency, formatPct, cn } from "@/lib/utils"

interface SimDetail {
  id: string
  name: string
  status: string
  platform: string
  initialCapital: number
  startDate: string
  endDate: string
  metrics: SimulationMetrics | null
  trades: Trade[]
  strategy: { name: string; platform: string }
}

function StatCard({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
        <p className={cn("text-xl font-bold", positive === true ? "text-green-400" : positive === false ? "text-red-400" : "")}>
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export default function SimulationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [sim, setSim] = useState<SimDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/simulations/${params.id}`)
      .then((r) => r.json())
      .then((d) => { setSim(d); setLoading(false) })
  }, [params.id])

  function handleExport() {
    if (!sim) return
    const blob = new Blob([JSON.stringify({ metrics: sim.metrics, trades: sim.trades }, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${sim.name.replace(/\s+/g, "_")}_results.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-muted-foreground">Loading simulation...</div></div>
  }
  if (!sim) return <div>Simulation not found</div>

  const m = sim.metrics

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{sim.name}</h1>
              <Badge variant={sim.status === "COMPLETED" ? "success" : "secondary"} className="text-xs capitalize">
                {sim.status.toLowerCase()}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {sim.strategy.name} · {sim.platform} · {formatCurrency(sim.initialCapital)} capital
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" /> Export JSON
        </Button>
      </div>

      {!m ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No metrics available</CardContent></Card>
      ) : (
        <>
          {/* Key metrics grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total ROI" value={formatPct(m.roi)} positive={m.roi >= 0} sub={formatCurrency(m.totalPnL)} />
            <StatCard label="Final Capital" value={formatCurrency(m.finalCapital)} sub={`started at ${formatCurrency(m.initialCapital)}`} />
            <StatCard label="Win Rate" value={`${m.winRate}%`} sub={`${m.winningTrades}W / ${m.losingTrades}L`} />
            <StatCard label="Total Trades" value={String(m.totalTrades)} sub={`avg ${m.avgTradeDurationDays}d hold`} />
            <StatCard label="Sharpe Ratio" value={String(m.sharpeRatio)} positive={m.sharpeRatio >= 1} />
            <StatCard label="Profit Factor" value={String(m.profitFactor)} positive={m.profitFactor >= 1} />
            <StatCard label="Max Drawdown" value={`-${m.maxDrawdownPct}%`} sub={formatCurrency(m.maxDrawdown)} positive={false} />
            <StatCard label="Avg Win / Loss" value={`${formatCurrency(m.avgWin)} / ${formatCurrency(m.avgLoss)}`} />
          </div>

          {/* Equity curve */}
          {m.equityCurve.length > 1 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Equity Curve</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={m.equityCurve}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="date" tick={{ fill: "#666", fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fill: "#666", fontSize: 11 }} tickLine={false} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                    <Tooltip
                      contentStyle={{ background: "#1a2035", border: "1px solid #2a3555", borderRadius: 6 }}
                      formatter={(v: number) => [formatCurrency(v), "Equity"]}
                    />
                    <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Monthly returns */}
          {m.monthlyReturns.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Monthly Returns</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={m.monthlyReturns}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="month" tick={{ fill: "#666", fontSize: 11 }} tickLine={false} />
                    <YAxis tick={{ fill: "#666", fontSize: 11 }} tickLine={false} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ background: "#1a2035", border: "1px solid #2a3555", borderRadius: 6 }}
                      formatter={(v: number) => [`${v}%`, "Return"]}
                    />
                    <Bar dataKey="returnPct" radius={[3, 3, 0, 0]}>
                      {m.monthlyReturns.map((entry, i) => (
                        <Cell key={i} fill={entry.returnPct >= 0 ? "#22c55e" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Platform breakdown */}
          {Object.keys(m.platformBreakdown).length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Platform Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.entries(m.platformBreakdown).map(([platform, data]) => (
                    <div key={platform} className="p-4 rounded-md bg-secondary/30">
                      <p className="font-medium capitalize mb-2">{platform}</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Trades</span><span>{data.trades}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">P&L</span><span className={data.pnl >= 0 ? "text-green-400" : "text-red-400"}>{formatCurrency(data.pnl)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Win Rate</span><span>{data.winRate}%</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trades table */}
          {sim.trades.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Trades ({sim.trades.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40">
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Market</th>
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Platform</th>
                        <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Side</th>
                        <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Entry</th>
                        <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Exit</th>
                        <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Size</th>
                        <th className="text-right py-2 text-muted-foreground font-medium">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sim.trades.slice(0, 50).map((trade) => (
                        <tr key={trade.id} className="border-b border-border/20 last:border-0">
                          <td className="py-2 pr-4 max-w-[180px] truncate text-xs">{trade.marketTitle}</td>
                          <td className="py-2 pr-4 capitalize text-xs text-muted-foreground">{trade.platform}</td>
                          <td className="py-2 pr-4">
                            <Badge variant={trade.outcome === "YES" ? "success" : "secondary"} className="text-xs">{trade.outcome}</Badge>
                          </td>
                          <td className="py-2 pr-4 text-right text-xs">{(trade.entryPrice * 100).toFixed(1)}¢</td>
                          <td className="py-2 pr-4 text-right text-xs">
                            {trade.exitPrice ? `${(trade.exitPrice * 100).toFixed(1)}¢` : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right text-xs">{formatCurrency(trade.size)}</td>
                          <td className={cn("py-2 text-right text-xs font-medium", trade.pnl !== undefined && trade.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                            {trade.pnl !== undefined ? formatCurrency(trade.pnl) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sim.trades.length > 50 && (
                    <p className="text-center text-xs text-muted-foreground mt-3">
                      Showing 50 of {sim.trades.length} trades. Export JSON for full data.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
