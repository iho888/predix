"use client"

import { useState, useEffect, useMemo } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ListFilter, Download, Copy, ExternalLink, FileDown } from "lucide-react"

type StrategyRow = {
  id: string
  name: string
  platform: string
  config: { templateId?: string }
}

type LiveEntry = {
  slug: string
  question: string
  maxPrice: number
  leadingOutcome: string
  edgeToPar: number
  liquidityNum: number | null
  volumeNum: number | null
  endDate: string | null
  urlPath: string
}

type LiveApplyResponse = {
  generatedAt: string
  strategyId: string
  strategyName: string
  marketsScanned: number
  matchCount: number
  entries: LiveEntry[]
}

function isHighProbBondStrategy(s: StrategyRow): boolean {
  const id = s.config?.templateId
  return id === "high_probability_bond" || id === "polywatch_bond"
}

export default function LiveApplyPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [strategyId, setStrategyId] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [result, setResult] = useState<LiveApplyResponse | null>(null)
  const [copyOk, setCopyOk] = useState(false)

  const bondStrategies = useMemo(() => strategies.filter(isHighProbBondStrategy), [strategies])

  useEffect(() => {
    fetch("/api/strategies")
      .then((r) => r.json())
      .then((data: StrategyRow[]) => {
        setStrategies(Array.isArray(data) ? data : [])
      })
      .catch(() => setStrategies([]))
  }, [])

  useEffect(() => {
    if (bondStrategies.length && !strategyId) {
      setStrategyId(bondStrategies[0].id)
    }
  }, [bondStrategies, strategyId])

  async function runApply() {
    setError("")
    setResult(null)
    setCopyOk(false)
    if (!strategyId) {
      setError("Select a strategy")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/live-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategyId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setResult(data as LiveApplyResponse)
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  function downloadJson() {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `live-apply-${result.strategyName.replace(/\s+/g, "-")}-${result.generatedAt.slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function csvCell(v: string | number | null | undefined): string {
    const s = v == null ? "" : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  function downloadCsv() {
    if (!result) return
    const header = [
      "slug",
      "maxPrice",
      "leadingOutcome",
      "question",
      "liquidityNum",
      "volumeNum",
      "endDate",
      "urlPath",
    ]
    const lines = [header.join(",")]
    for (const e of result.entries) {
      lines.push(
        [
          csvCell(e.slug),
          csvCell(e.maxPrice),
          csvCell(e.leadingOutcome),
          csvCell(e.question),
          csvCell(e.liquidityNum),
          csvCell(e.volumeNum),
          csvCell(e.endDate),
          csvCell(e.urlPath),
        ].join(",")
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `live-apply-${result.strategyName.replace(/\s+/g, "-")}-${result.generatedAt.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function copyJson() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2))
      setCopyOk(true)
      setTimeout(() => setCopyOk(false), 2000)
    } catch {
      setError("Could not copy to clipboard")
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ListFilter className="w-8 h-8" />
          Live apply
        </h1>
        <p className="text-muted-foreground mt-1">
          Fetch current Polymarket markets and filter by a <strong>High-probability bond</strong> strategy. Nothing is
          saved on the server—export or copy if you need a record.
        </p>
      </div>

      {bondStrategies.length === 0 && strategies.length > 0 && (
        <div className="p-4 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 text-sm">
          You need a High-probability bond strategy.{" "}
          <Link href="/dashboard/strategies" className="underline">
            Create one
          </Link>{" "}
          (the “Classic” template is for backtests only here).
        </div>
      )}

      {strategies.length === 0 && (
        <div className="p-4 rounded-md bg-muted/30 border text-sm text-muted-foreground">
          <Link href="/dashboard/strategies" className="underline">
            Create a strategy
          </Link>{" "}
          first.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Run filter</CardTitle>
          <CardDescription>
            Uses your saved min/max price, liquidity, volume, and resolution window. May take a minute while markets are
            downloaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end">
            <div className="space-y-2 flex-1 min-w-0">
              <Label>Strategy (High-probability bond only)</Label>
              <Select
                value={strategyId}
                onValueChange={setStrategyId}
                disabled={bondStrategies.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select strategy…" />
                </SelectTrigger>
                <SelectContent>
                  {bondStrategies.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} · {s.platform}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runApply} disabled={loading || !strategyId} className="shrink-0">
              {loading ? "Scanning…" : "Apply to live data"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>Matches</CardTitle>
              <CardDescription>
                {result.matchCount} of {result.marketsScanned} markets scanned · {result.generatedAt}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={copyJson}>
                <Copy className="w-4 h-4 mr-1" />
                {copyOk ? "Copied" : "Copy JSON"}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadJson}>
                <Download className="w-4 h-4 mr-1" />
                Download JSON
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadCsv}>
                <FileDown className="w-4 h-4 mr-1" />
                Download CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-[min(60vh,520px)] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b">
                  <tr className="text-left text-muted-foreground">
                    <th className="p-2 font-medium">Slug</th>
                    <th className="p-2 font-medium">Max price</th>
                    <th className="p-2 font-medium min-w-[200px]">Question</th>
                    <th className="p-2 font-medium">Liq / vol</th>
                    <th className="p-2 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-muted-foreground">
                        No markets passed the filter.
                      </td>
                    </tr>
                  ) : (
                    result.entries.map((e) => (
                      <tr key={e.slug} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="p-2 font-mono text-xs break-all max-w-[140px]">{e.slug || "—"}</td>
                        <td className="p-2 tabular-nums">{e.maxPrice.toFixed(3)}</td>
                        <td className="p-2 text-muted-foreground line-clamp-2">{e.question}</td>
                        <td className="p-2 text-xs text-muted-foreground tabular-nums">
                          {e.liquidityNum != null ? e.liquidityNum.toLocaleString() : "—"} /{" "}
                          {e.volumeNum != null ? e.volumeNum.toLocaleString() : "—"}
                        </td>
                        <td className="p-2">
                          {e.urlPath ? (
                            <a
                              href={e.urlPath}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary inline-flex"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
