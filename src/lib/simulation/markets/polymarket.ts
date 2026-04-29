import { MarketTick, Platform } from "@/types"
import { addDays, addHours } from "date-fns"

const POLYMARKET_TOPICS = [
  "Will Bitcoin exceed $100k by end of 2024?",
  "Will the Fed cut rates in Q4 2024?",
  "Will SpaceX Starship reach orbit in 2024?",
  "Will Ukraine-Russia ceasefire happen by 2025?",
  "Will AI surpass human chess by 2025?",
  "Will US GDP growth exceed 3% in 2024?",
  "Will Elon Musk remain Twitter CEO through 2025?",
  "Will a Democrat win the 2024 US Senate majority?",
  "Will OpenAI release GPT-5 in 2024?",
  "Will Apple Vision Pro sales exceed 1M units?",
  "Will crypto market cap reach $3T in 2024?",
  "Will inflation drop below 2.5% by Dec 2024?",
  "Will NVIDIA stock double from Jan 2024?",
  "Will China invade Taiwan before 2026?",
  "Will US recession occur in 2024?",
]

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function generatePriceWalk(
  startPrice: number,
  steps: number,
  volatility: number,
  drift: number,
  rand: () => number
): number[] {
  const prices: number[] = [startPrice]
  for (let i = 1; i < steps; i++) {
    const change = (rand() - 0.5) * volatility + drift
    const newPrice = Math.max(0.02, Math.min(0.98, prices[i - 1] + change))
    prices.push(newPrice)
  }
  return prices
}

export function generatePolymarketTicks(
  startDate: Date,
  endDate: Date,
  tickIntervalHours: number = 6
): MarketTick[] {
  const ticks: MarketTick[] = []
  const marketCount = 8

  for (let m = 0; m < marketCount; m++) {
    const rand = seededRandom(m * 12345 + 9876)
    const topic = POLYMARKET_TOPICS[m % POLYMARKET_TOPICS.length]
    const marketId = `poly_${m.toString().padStart(4, "0")}`

    const startPrice = 0.15 + rand() * 0.7
    const volatility = 0.02 + rand() * 0.04
    const drift = (rand() - 0.5) * 0.003

    const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
    const steps = Math.ceil(totalHours / tickIntervalHours)

    const prices = generatePriceWalk(startPrice, steps, volatility, drift, rand)
    const resolveDate = addDays(endDate, Math.floor(rand() * 30))

    let baseVolume = 50000 + rand() * 500000

    for (let i = 0; i < steps; i++) {
      const timestamp = addHours(startDate, i * tickIntervalHours)
      if (timestamp > endDate) break

      const yesPrice = prices[i]
      const prevPrice = i > 0 ? prices[i - 1] : yesPrice

      let trend: "rising" | "falling" | "stable"
      const delta = yesPrice - prevPrice
      if (delta > 0.005) trend = "rising"
      else if (delta < -0.005) trend = "falling"
      else trend = "stable"

      const volumeChange = (rand() - 0.4) * 5000
      baseVolume = Math.max(10000, baseVolume + volumeChange)

      ticks.push({
        marketId,
        title: topic,
        timestamp,
        yesPrice,
        noPrice: 1 - yesPrice,
        volume24h: Math.round(baseVolume * (0.1 + rand() * 0.2)),
        totalVolume: Math.round(baseVolume),
        liquidity: Math.round(baseVolume * 0.15),
        trend,
        platform: "polymarket" as Platform,
        resolveDate,
      })
    }
  }

  return ticks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
