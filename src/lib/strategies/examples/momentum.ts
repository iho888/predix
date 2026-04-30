import type { StrategyFn } from "../types"

/** If implied YES dropped over the last few points, buy YES (simple dip). */
export const momentumDipYes: StrategyFn = (ctx) => {
  const pts = ctx.priceHistory
  if (pts.length < 5) {
    return { side: null, price: 0, size: 0, reason: "Need at least 5 price points" }
  }
  const recent = pts.slice(-5)
  const drop = recent[0].p - recent[recent.length - 1].p
  if (drop > 0.08) {
    return {
      side: "YES",
      price: ctx.currentPrice,
      size: 1,
      reason: `Outcome 0 fell ${(drop * 100).toFixed(1)}% over last ${recent.length} samples`,
    }
  }
  return { side: null, price: 0, size: 0, reason: "No dip threshold met" }
}
