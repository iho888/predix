"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type StoredStats = {
  totalMarkets: number
  earliestEndDate: string | null
  latestEndDate: string | null
  latestSync: { startedAt: string; finishedAt: string | null; status: string } | null
}

function hoursAgo(iso: string): number {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, (Date.now() - t) / 3_600_000)
}

export function DataStatusBar({ onSynced }: { onSynced?: () => void }) {
  const [stats, setStats] = useState<StoredStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch("/api/markets/stored", { cache: "no-store" })
      if (res.ok) setStats(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const lastSyncedLabel = useMemo(() => {
    const startedAt = stats?.latestSync?.startedAt
    if (!startedAt) return "—"
    const h = hoursAgo(startedAt)
    if (h < 1) return "just now"
    if (h < 48) return `${Math.round(h)}h ago`
    return `${Math.round(h / 24)}d ago`
  }, [stats?.latestSync?.startedAt])

  async function runSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/sync/trigger", { method: "POST" })
      if (!res.ok) return
      await load()
      onSynced?.()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={cn("rounded-lg border bg-card px-4 py-3 flex items-center justify-between gap-3", syncing && "opacity-90")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Stored markets</span>
          <span className="font-medium">{stats?.totalMarkets ?? (loading ? "…" : "0")}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Coverage</span>
          <span className="font-medium">
            {stats?.earliestEndDate ? new Date(stats.earliestEndDate).toLocaleDateString() : "—"} →{" "}
            {stats?.latestEndDate ? new Date(stats.latestEndDate).toLocaleDateString() : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Last synced</span>
          <span className="font-medium">{lastSyncedLabel}</span>
          {stats?.latestSync?.status && (
            <Badge variant={stats.latestSync.status === "completed" ? "success" : stats.latestSync.status === "failed" ? "destructive" : "secondary"} className="text-xs capitalize">
              {stats.latestSync.status}
            </Badge>
          )}
        </div>
      </div>

      <Button variant="outline" onClick={runSync} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  )
}

