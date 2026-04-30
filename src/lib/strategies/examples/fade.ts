import type { StrategyFn } from "../types"

/** Fade extreme implied probs: lean NO when YES is very high, YES when very low. */
export const fadeExtremes: StrategyFn = (ctx) => {
  const y = ctx.currentPrice
  if (y > 0.9) {
    return {
      side: "NO",
      price: 1 - y,
      size: 1,
      reason: `Outcome 0 at ${(y * 100).toFixed(0)}% — fade toward NO`,
    }
  }
  if (y < 0.1) {
    return { side: "YES", price: y, size: 1, reason: `Outcome 0 at ${(y * 100).toFixed(0)}% — fade toward YES` }
  }
  return { side: null, price: 0, size: 0, reason: "No extreme edge" }
}
