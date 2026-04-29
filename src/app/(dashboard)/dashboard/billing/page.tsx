"use client"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, CreditCard, Clock, Zap, Star } from "lucide-react"
import { PLANS } from "@/lib/plans"
import { UserSession } from "@/types"

export default function BillingPage() {
  const [user, setUser] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch("/api/user/me").then((r) => r.json()).then(setUser)
  }, [])

  async function handleSubscribe() {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/create-checkout", { method: "POST" })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  async function handleManage() {
    setLoading(true)
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  const isActive = user?.subscriptionStatus === "ACTIVE"
  const isTrial = user?.subscriptionStatus === "TRIAL" && (user.trialDaysLeft ?? 0) > 0
  const isExpired =
    user?.subscriptionStatus === "EXPIRED" ||
    user?.subscriptionStatus === "CANCELLED" ||
    (user?.subscriptionStatus === "TRIAL" && (user.trialDaysLeft ?? 0) <= 0)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground mt-1">Manage your subscription</p>
      </div>

      {/* Current status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isActive ? (
                <>
                  <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <Star className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Predix Pro</p>
                    <p className="text-sm text-muted-foreground">$29/month — full access</p>
                  </div>
                </>
              ) : isTrial ? (
                <>
                  <div className="w-10 h-10 bg-yellow-500/20 rounded-full flex items-center justify-center">
                    <Clock className="w-5 h-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="font-semibold">Free Trial</p>
                    <p className="text-sm text-muted-foreground">{user?.trialDaysLeft} days remaining</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 bg-destructive/20 rounded-full flex items-center justify-center">
                    <Zap className="w-5 h-5 text-destructive" />
                  </div>
                  <div>
                    <p className="font-semibold">No Active Plan</p>
                    <p className="text-sm text-muted-foreground">Subscribe to continue using Predix</p>
                  </div>
                </>
              )}
            </div>
            <div>
              {isActive ? (
                <Badge variant="success">Active</Badge>
              ) : isTrial ? (
                <Badge variant="warning">Trial</Badge>
              ) : (
                <Badge variant="destructive">Expired</Badge>
              )}
            </div>
          </div>

          {isActive && (
            <div className="mt-4 pt-4 border-t border-border/40">
              <Button variant="outline" onClick={handleManage} disabled={loading}>
                <CreditCard className="w-4 h-4 mr-2" />
                Manage Subscription
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pro plan card */}
      {!isActive && (
        <Card className="border-blue-500/40 bg-blue-500/5 shadow-lg shadow-blue-500/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <Badge className="mb-2 bg-blue-500 text-white">Recommended</Badge>
                <CardTitle>{PLANS.monthly.name}</CardTitle>
                <CardDescription>Everything you need for serious prediction market trading</CardDescription>
              </div>
              <div className="text-right">
                <p className="text-4xl font-bold">${PLANS.monthly.price}</p>
                <p className="text-muted-foreground text-sm">/{PLANS.monthly.interval}</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 mb-6">
              {PLANS.monthly.features.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Button className="w-full" size="lg" onClick={handleSubscribe} disabled={loading}>
              {loading ? "Redirecting to checkout..." : "Subscribe — $29/month"}
            </Button>
            <p className="text-center text-xs text-muted-foreground mt-3">
              Secure payment via Stripe. Cancel anytime.
            </p>
          </CardContent>
        </Card>
      )}

      {/* FAQ */}
      <Card>
        <CardHeader><CardTitle className="text-base">Frequently Asked Questions</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {[
            ["Can I cancel anytime?", "Yes. You can cancel your subscription at any time from the billing portal. Your access continues until the end of the billing period."],
            ["What happens when my trial ends?", "After 14 days, your account enters read-only mode. You can still view past simulations but cannot create new ones until you subscribe."],
            ["Is this real money?", "No. Predix is a simulation platform only. All trading data is mock/synthetic — no real money is used or at risk."],
            ["Which platforms are supported?", "Currently Polymarket and Kaishi. More prediction market platforms will be added over time."],
          ].map(([q, a]) => (
            <div key={q}>
              <p className="font-medium mb-1">{q}</p>
              <p className="text-muted-foreground">{a}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
