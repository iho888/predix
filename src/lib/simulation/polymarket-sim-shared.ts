import type { HighProbabilityBondParams } from "@/types"

export function randomSimId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export function exitPriceForSide(side: "YES" | "NO", winningOutcomeIndex: 0 | 1): number {
  if (side === "YES") return winningOutcomeIndex === 0 ? 1 : 0
  return winningOutcomeIndex === 1 ? 1 : 0
}

export function leadingSideAtYesPrice(yesPx: number): { side: "YES" | "NO"; entryPrice: number; leadingPrice: number } {
  const noPx = 1 - yesPx
  if (yesPx >= noPx) return { side: "YES", entryPrice: yesPx, leadingPrice: yesPx }
  return { side: "NO", entryPrice: noPx, leadingPrice: noPx }
}

export function entryBandOk(leadingPrice: number, params: HighProbabilityBondParams): boolean {
  if (leadingPrice < params.minPrice) return false
  if (params.maxPrice != null && leadingPrice > params.maxPrice) return false
  return true
}

/** Gamma liquidity/volume gates using **current** row values (point-in-time limitation). */
export function gammaLiquidityVolumeGatesOk(row: Record<string, unknown>, params: HighProbabilityBondParams): boolean {
  const liqRaw = row.liquidityNum
  const volRaw = row.volumeNum
  const liq = typeof liqRaw === "number" ? liqRaw : liqRaw != null ? Number(liqRaw) : NaN
  const vol = typeof volRaw === "number" ? volRaw : volRaw != null ? Number(volRaw) : NaN
  if (Number.isFinite(liq) && liq < params.minLiquidityNum) return false
  if (Number.isFinite(vol) && vol < params.minVolumeNum) return false
  return true
}
