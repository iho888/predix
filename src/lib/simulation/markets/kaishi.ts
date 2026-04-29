import { MarketTick, Platform } from "@/types"
import { addDays, addHours } from "date-fns"

const KAISHI_TOPICS = [
  "Will ETH/USD be above $3000 on Dec 31?",
  "Will SOL/USD hit $200 before Q1 2025?",
  "Will BTC dominance exceed 60% in 2024?",
  "Will DeFi TVL reach $100B again?",
  "Will Arbitrum surpass Ethereum in TXs?",
  "Will USDC maintain $1 peg through 2025?",
  "Will NFT market recover in 2024?",
  "Will Celsius creditors receive full repayment?",
  "Will Base chain TVL exceed $5B?",
  "Will Binance avoid US shutdown in 2024?",
  "Will Web3 gaming hit 10M daily users?",
  "Will Ethereum staking yield stay above 4%?",
]

function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

function generateCryptoWalk(
  startPrice: number,
  steps: number,
  volatility: number,
  drift: number,
  rand: () => number
): number[] {
  const prices: number[] = [startPrice]
  for (let i = 1; i < steps; i++) {
    // Crypto markets: fatter tails, occasional spikes
    const spike = rand() > 0.95 ? (rand() - 0.5) * volatility * 4 : 0
    const change = (rand() - 0.5) * volatility + drift + spike
    const newPrice = Math.max(0.02, Math.min(0.98, prices[i - 1] + change))
    prices.push(newPrice)
  }
  return prices
}

export function generateKaishiTicks(
  startDate: Date,
  endDate: Date,
  tickIntervalHours: number = 4
): MarketTick[] {
  const ticks: MarketTick[] = []
  const marketCount = 6

  for (let m = 0; m < marketCount; m++) {
    const rand = seededRandom(m * 54321 + 11111)
    const topic = KAISHI_TOPICS[m % KAISHI_TOPICS.length]
    const marketId = `kaishi_${m.toString().padStart(4, "0")}`

    const startPrice = 0.2 + rand() * 0.6
    // Crypto is more volatile
    const volatility = 0.03 + rand() * 0.06
    const drift = (rand() - 0.5) * 0.004

    const totalHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
    const steps = Math.ceil(totalHours / tickIntervalHours)

    const prices = generateCryptoWalk(startPrice, steps, volatility, drift, rand)
    const resolveDate = addDays(endDate, Math.floor(rand() * 60))

    let baseVolume = 20000 + rand() * 200000

    for (let i = 0; i < steps; i++) {
      const timestamp = addHours(startDate, i * tickIntervalHours)
      if (timestamp > endDate) break

      const yesPrice = prices[i]
      const prevPrice = i > 0 ? prices[i - 1] : yesPrice

      let trend: "rising" | "falling" | "stable"
      const delta = yesPrice - prevPrice
      if (delta > 0.008) trend = "rising"
      else if (delta < -0.008) trend = "falling"
      else trend = "stable"

      baseVolume = Math.max(5000, baseVolume + (rand() - 0.4) * 8000)

      ticks.push({
        marketId,
        title: topic,
        timestamp,
        yesPrice,
        noPrice: 1 - yesPrice,
        volume24h: Math.round(baseVolume * (0.15 + rand() * 0.3)),
        totalVolume: Math.round(baseVolume),
        liquidity: Math.round(baseVolume * 0.12),
        trend,
        platform: "kaishi" as Platform,
        resolveDate,
      })
    }
  }

  return ticks.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
}
