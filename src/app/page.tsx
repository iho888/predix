import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, BarChart3, Zap, Shield, Clock, CheckCircle } from "lucide-react"

const features = [
  {
    icon: TrendingUp,
    title: "Strategy Builder",
    desc: "Define entry/exit conditions, position sizing, and risk parameters in a visual editor.",
  },
  {
    icon: BarChart3,
    title: "Realistic Simulation",
    desc: "Backtest against mock Polymarket and Kaishi market data with realistic price dynamics.",
  },
  {
    icon: Zap,
    title: "Instant Metrics",
    desc: "Win rate, Sharpe ratio, max drawdown, ROI, equity curve — all computed in seconds.",
  },
  {
    icon: Shield,
    title: "Multi-Platform",
    desc: "Simulate across Polymarket, Kaishi, and generic prediction market data.",
  },
  {
    icon: Clock,
    title: "14-Day Free Trial",
    desc: "Full access to all features for 14 days. No credit card required to start.",
  },
  {
    icon: CheckCircle,
    title: "Export Reports",
    desc: "Download your simulation results as JSON to analyze or share with your team.",
  },
]

const plans = [
  {
    name: "Free Trial",
    price: "$0",
    period: "14 days",
    features: ["5 strategies", "10 simulations", "Polymarket + Kaishi", "Core metrics"],
    cta: "Start Free Trial",
    href: "/register",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$29",
    period: "/month",
    features: [
      "Unlimited strategies",
      "Unlimited simulations",
      "All platforms",
      "Advanced analytics",
      "Export CSV/JSON",
      "Priority support",
    ],
    cta: "Subscribe Now",
    href: "/register",
    highlight: true,
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border/40 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold">Predix</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost">Log in</Button>
            </Link>
            <Link href="/register">
              <Button>Start Free Trial</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 py-24 text-center">
        <Badge className="mb-6 bg-blue-500/10 text-blue-400 border-blue-500/20" variant="outline">
          Now supporting Polymarket & Kaishi
        </Badge>
        <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
          Simulate Trading Strategies
          <br />
          <span className="gradient-text">on Prediction Markets</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Build, backtest, and refine your prediction market trading strategies with realistic
          simulation data — before risking real money.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/register">
            <Button size="lg" className="px-8">
              Start Free Trial
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="px-8">
              Log In
            </Button>
          </Link>
        </div>
        <p className="mt-4 text-sm text-muted-foreground">14 days free — no credit card required</p>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Everything you need to test your edge</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="glow-card rounded-lg border bg-card p-6">
              <f.icon className="w-10 h-10 text-blue-400 mb-4" />
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-muted-foreground text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-4">Simple, transparent pricing</h2>
        <p className="text-center text-muted-foreground mb-12">Start free, upgrade when you are ready</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-lg border p-8 ${
                plan.highlight
                  ? "border-blue-500/50 bg-blue-500/5 shadow-lg shadow-blue-500/10"
                  : "border-border bg-card"
              }`}
            >
              {plan.highlight && (
                <Badge className="mb-4 bg-blue-500 text-white">Most Popular</Badge>
              )}
              <h3 className="text-2xl font-bold">{plan.name}</h3>
              <div className="my-4">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="text-muted-foreground">{plan.period}</span>
              </div>
              <ul className="space-y-3 mb-8">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link href={plan.href}>
                <Button
                  className="w-full"
                  variant={plan.highlight ? "default" : "outline"}
                >
                  {plan.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/40 px-6 py-8 mt-16">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>© 2024 Predix. All rights reserved.</span>
          <span>Built for prediction market traders</span>
        </div>
      </footer>
    </div>
  )
}
