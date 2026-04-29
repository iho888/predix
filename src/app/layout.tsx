import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Predix — Prediction Market Trading Simulator",
  description: "Simulate and backtest trading strategies on Polymarket, Kaishi, and other prediction markets.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>{children}</body>
    </html>
  )
}
