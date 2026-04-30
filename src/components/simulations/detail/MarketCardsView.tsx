"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn, formatCurrency } from "@/lib/utils"
import type { SimulatedTradeRow } from "@/types"
import { Line, LineChart, ResponsiveContainer } from "recharts"

type PolyTrade = Extract<SimulatedTradeRow, { source: "polymarket" }>

function isPolyTrade(t: unknown): t is PolyTrade {
  return !!t && typeof t === "object" && (t as any).source === "polymarket" && "slug" in (t as any) && "pnl" in (t as any)
}

function sparkData(t: PolyTrade) {
  const e = t.entryPrice
  const x = t.exitPrice
  // Not true history (we don't store intra-trade series yet). This is a tiny visual cue only.
  return [
    { i: 0, p: e },
    { i: 1, p: (e + x) / 2 },
    { i: 2, p: x },
  ]
}

export function MarketCardsView({ trades }: { trades: unknown[] }) {
  const [filter, setFilter] = useState<"all" | "won" | "lost">("all")
  const [q, setQ] = useState("")

  const poly = useMemo(() => trades.filter(isPolyTrade), [trades])

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return poly.filter((t) => {
      if (filter === "won" && !t.won) return false
      if (filter === "lost" && t.won) return false
      if (!query) return true
      return t.slug.toLowerCase().includes(query) || t.question.toLowerCase().includes(query)
    })
  }, [poly, filter, q])

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button
            className={cn("text-sm px-3 py-1 rounded-md border", filter === "all" ? "bg-secondary" : "bg-card")}
            onClick={() => setFilter("all")}
            type="button"
          >
            All
          </button>
          <button
            className={cn("text-sm px-3 py-1 rounded-md border", filter === "won" ? "bg-secondary" : "bg-card")}
            onClick={() => setFilter("won")}
            type="button"
          >
            Won
          </button>
          <button
            className={cn("text-sm px-3 py-1 rounded-md border", filter === "lost" ? "bg-secondary" : "bg-card")}
            onClick={() => setFilter("lost")}
            type="button"
          >
            Lost
          </button>
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by slug or question…" className="sm:max-w-sm" />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No matching trades.</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((t) => (
            <Card key={t.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base truncate">{t.question}</CardTitle>
                    <p className="text-xs text-muted-foreground truncate mt-1">{t.slug}</p>
                  </div>
                  <Badge variant={t.won ? "success" : "destructive"} className="text-xs">
                    {t.won ? "Won" : "Lost"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={t.side === "YES" ? "success" : "secondary"} className="text-xs">
                      {t.side}
                    </Badge>
                    <span className="text-muted-foreground">Entry → Exit</span>
                  </div>
                  <span className="font-medium">
                    {(t.entryPrice * 100).toFixed(1)}¢ → {(t.exitPrice * 100).toFixed(1)}¢
                  </span>
                </div>

                <div className="h-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparkData(t)}>
                      <Line type="monotone" dataKey="p" stroke={t.won ? "#22c55e" : "#ef4444"} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">P&L</span>
                  <span className={cn("font-semibold", t.pnl >= 0 ? "text-green-400" : "text-red-400")}>
                    {formatCurrency(t.pnl)} ({formatCurrency(t.positionSizeUsd)})
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

