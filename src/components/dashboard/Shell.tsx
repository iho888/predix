"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { TrendingUp, LayoutDashboard, Zap, PlayCircle, CreditCard, LogOut, Clock, ListFilter, Briefcase } from "lucide-react"
import { UserSession } from "@/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/strategies", label: "Strategies", icon: Zap },
  { href: "/dashboard/live-apply", label: "Live apply", icon: ListFilter },
  { href: "/dashboard/paper-positions", label: "Paper trades", icon: Briefcase },
  { href: "/dashboard/simulations", label: "Simulations", icon: PlayCircle },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
]

export default function DashboardShell({
  session,
  children,
}: {
  session: UserSession
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.push("/login")
  }

  const isExpired =
    session.subscriptionStatus === "EXPIRED" || session.subscriptionStatus === "CANCELLED" ||
    (session.subscriptionStatus === "TRIAL" && session.trialDaysLeft <= 0)

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border/40 flex flex-col">
        <div className="p-6 border-b border-border/40">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">Predix</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Subscription status */}
        <div className="p-4 border-t border-border/40">
          {session.subscriptionStatus === "TRIAL" && session.trialDaysLeft > 0 ? (
            <div className="bg-blue-500/10 rounded-md p-3 mb-3">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-3 h-3 text-blue-400" />
                <span className="text-xs font-medium text-blue-400">Free Trial</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {session.trialDaysLeft} day{session.trialDaysLeft !== 1 ? "s" : ""} remaining
              </p>
              <Link href="/dashboard/billing" className="text-xs text-blue-400 hover:underline mt-1 block">
                Upgrade to Pro →
              </Link>
            </div>
          ) : isExpired ? (
            <div className="bg-destructive/10 rounded-md p-3 mb-3">
              <p className="text-xs font-medium text-destructive mb-1">Trial expired</p>
              <Link href="/dashboard/billing" className="text-xs text-blue-400 hover:underline">
                Subscribe to continue →
              </Link>
            </div>
          ) : (
            <div className="mb-3">
              <Badge variant="success" className="text-xs">Pro Active</Badge>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm">
            <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">
              {session.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-xs truncate">{session.name}</p>
              <p className="text-muted-foreground text-xs truncate">{session.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {isExpired && (
          <div className="bg-destructive/20 border-b border-destructive/30 px-6 py-2 text-sm text-center">
            Your trial has expired.{" "}
            <Link href="/dashboard/billing" className="font-medium underline">
              Subscribe now
            </Link>{" "}
            to continue using Predix.
          </div>
        )}
        <div className="p-6">{children}</div>
      </main>
    </div>
  )
}
