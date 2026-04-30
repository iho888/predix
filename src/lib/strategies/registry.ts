import type { StrategyMeta } from "./types"
import { fadeExtremes } from "./examples/fade"
import { momentumDipYes } from "./examples/momentum"

export const strategyRegistry: StrategyMeta[] = [
  {
    id: "fade_extremes",
    name: "Fade extremes",
    description: "Suggests NO when outcome 0 is very high, YES when very low (binary markets).",
    fn: fadeExtremes,
  },
  {
    id: "momentum_dip_yes",
    name: "Momentum dip (YES)",
    description: "If outcome 0 price fell over the last few samples, suggest buying YES.",
    fn: momentumDipYes,
  },
]

export function getStrategyById(id: string): StrategyMeta | undefined {
  return strategyRegistry.find((s) => s.id === id)
}
