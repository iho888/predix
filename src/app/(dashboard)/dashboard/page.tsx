import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Zap, PlayCircle, TrendingUp, TrendingDown, Plus } from "lucide-react"
import { formatCurrency, formatPct } from "@/lib/utils"
import { SimulationMetrics } from "@/types"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await getSession()
  if (!session) return null

  const [strategies, simulations] = await Promise.all([
    prisma.strategy.findMany({
      where: { userId: session.id, isActive: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.simulation.findMany({
      where: { userId: session.id, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { strategy: { select: { name: true } } },
    }),
  ])

  const totalSimulations = await prisma.simulation.count({ where: { userId: session.id } })
  const completedSims = await prisma.simulation.count({ where: { userId: session.id, status: "COMPLETED" } })

  // Aggregate P&L across all completed simulations
  const allMetrics = simulations
    .filter((s) => s.metricsJson)
    .map((s) => JSON.parse(s.metricsJson!) as SimulationMetrics)

  const totalPnL = allMetrics.reduce((sum, m) => sum + m.totalPnL, 0)
  const avgWinRate = allMetrics.length > 0
    ? allMetrics.reduce((sum, m) => sum + m.winRate, 0) / allMetrics.length
    : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Welcome back, {session.name.split(" ")[0]}</h1>
        <p className="text-muted-foreground mt-1">Here&apos;s an overview of your trading simulations</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Link href="/dashboard/live-apply">
            <Button variant="secondary" size="sm">Live apply</Button>
          </Link>
          <Link href="/dashboard/strategies">
            <Button variant="outline" size="sm">Strategies</Button>
          </Link>
          <Link href="/dashboard/simulations">
            <Button variant="outline" size="sm">Simulations</Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Strategies</p>
                <p className="text-2xl font-bold">{strategies.length}</p>
              </div>
              <Zap className="w-8 h-8 text-yellow-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Simulations</p>
                <p className="text-2xl font-bold">{totalSimulations}</p>
              </div>
              <PlayCircle className="w-8 h-8 text-blue-400 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total P&L</p>
                <p className={`text-2xl font-bold ${totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatCurrency(totalPnL)}
                </p>
              </div>
              {totalPnL >= 0 ? (
                <TrendingUp className="w-8 h-8 text-green-400 opacity-50" />
              ) : (
                <TrendingDown className="w-8 h-8 text-red-400 opacity-50" />
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Avg Win Rate</p>
                <p className="text-2xl font-bold">{avgWinRate.toFixed(1)}%</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">
                {avgWinRate > 50 ? "+" : ""}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Strategies */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Strategies</CardTitle>
            <Link href="/dashboard/strategies">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {strategies.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm mb-3">No strategies yet</p>
                <Link href="/dashboard/strategies">
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-1" /> Create Strategy
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {strategies.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                    <div>
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{s.platform}</p>
                    </div>
                    <Badge variant="outline" className="capitalize text-xs">{s.platform}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Simulations */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Simulations</CardTitle>
            <Link href="/dashboard/simulations">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {simulations.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm mb-3">No simulations yet</p>
                <Link href="/dashboard/simulations">
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-1" /> Run Simulation
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {simulations.map((s) => {
                  const metrics = s.metricsJson ? JSON.parse(s.metricsJson) as SimulationMetrics : null
                  return (
                    <Link key={s.id} href={`/dashboard/simulations/${s.id}`}>
                      <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0 hover:bg-accent/30 rounded px-1 transition-colors">
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{s.strategy.name}</p>
                        </div>
                        {metrics && (
                          <span className={`text-sm font-medium ${metrics.totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {formatPct(metrics.roi)}
                          </span>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
