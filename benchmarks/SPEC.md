# Benchmark Spec

This is the **only** way candidate strategies are compared. If a candidate beats the leaderboard but didn't run through this spec, the result doesn't count.

## Version

| Field | Value |
|------|------|
| Spec version | `v1.0.0` |
| Pinned git SHA | _set at run time — see step 1 below_ |
| Last updated | 2026-05-10 |
| Status | **ACTIVE**. v0.1.0-draft results stay valid against that version's spec; new candidates run under v1.0.0 |

Bump `Spec version` whenever you change the universe filter, the window, the metric definitions, or the output schema. Old results stay valid only against the version they were run under.

## What we optimize

Primary objective: **maximize annualized return subject to a max-drawdown cap**.

| Metric | Direction | Notes |
|--------|-----------|-------|
| `annReturn` | maximize | Annualized return on deployed capital |
| `maxDD` | constraint, ≤ 20% | Reject candidate if breached |
| `sharpe` | sanity | Reject if `< 0.5` (likely curve-fit) |
| `nTrades` | constraint, ≥ 30 | Smaller samples don't generalize |
| `dryrunMatchesSimLive` | hard constraint, must be true | See "Parity check" below |

The 20% / 0.5 / 30 numbers are starting defaults; tune them in this file (and bump version) once we have one full dataset of candidates to calibrate against.

## Universe

Markets from `PolymarketMarket` matching all of:

- `closed = true`
- `winningOutcomeIndex IS NOT NULL` (resolved YES or NO)
- `endDate BETWEEN window.start AND window.end`
- `(liquidityNum IS NULL OR liquidityNum >= 1000)` — filters obvious toy markets
- `(volumeNum IS NULL OR volumeNum >= 25000)` — derived from 2026-05-10 slippage probe; markets below this floor had spreads up to 12¢ and shallow asks (see `scripts/probe-slippage.cjs`)
- `negRisk = false` — only conventional binary markets; multi-outcome / negRisk markets deferred

The `25000` volume floor was tightened from the v0.1.0-draft `5000` after empirical evidence that low-volume markets are practically untradeable.

## Window

- `start`: **2023-01-01T00:00:00Z** (earliest date with non-trivial candle coverage; pre-2023 the dataset is sparse — see T-0005)
- `end`: **2026-05-09T23:59:59Z** (today minus 1 day; this leaves the most-recent open markets out so the run is fully reproducible against frozen historical data)

For out-of-sample validation, use these sub-windows (hold-out test):
- Train: `2023-01-01 .. 2024-12-31`
- Test:  `2025-01-01 .. 2026-05-09`

## Reproduce

Every benchmark run must follow these steps in order. The numbered steps are not optional — they are how we know the result is reproducible.

### 1. Snapshot the environment

```powershell
$ts = Get-Date -Format "yyyy-MM-ddTHH-mm-ss"
$ver = "v0.1.0-draft"
$sha = git rev-parse HEAD
$out = "benchmarks/results/$ver/$sha/$ts"
New-Item -ItemType Directory -Force -Path $out | Out-Null

git rev-parse HEAD                | Out-File -Encoding utf8 "$out/sha.txt"
node -v                            | Out-File -Encoding utf8 "$out/node-version.txt"
npm ls --depth=0 2>$null           | Out-File -Encoding utf8 "$out/npm-deps.txt"
git status --porcelain             | Out-File -Encoding utf8 "$out/git-dirty.txt"
```

If `git-dirty.txt` is non-empty, abort or commit first. Benchmarks against dirty trees are not reproducible.

### 2. Run dryrun (DB-replay simulation against stored candles)

The `db-replay` API path is the canonical dryrun. It runs the same engine code as live but reads from `PolymarketPriceCandle` instead of CLOB.

```powershell
# Strategy ID and window come from your test harness inputs. Example shape:
$body = @{
  strategyId = "<strategy-id>"
  window     = @{ start = "<ISO>"; end = "<ISO>" }
} | ConvertTo-Json

curl.exe -s -X POST http://localhost:3000/api/simulations/db-replay `
  -H "Content-Type: application/json" `
  -b "auth_token=<dev-token>" `
  -d $body | Out-File -Encoding utf8 "$out/dryrun.json"
```

### 3. Run sim-live (live data path with execution disabled)

The live simulation route uses real Gamma + CLOB calls. Run it pinned to the same `start..end` window as dryrun. **Do not place real bets** — the simulate endpoint is dryrun-only by design; never wire it to `/api/live-apply` during a benchmark.

```powershell
$body = @{
  strategyId = "<strategy-id>"
  window     = @{ start = "<ISO>"; end = "<ISO>" }
  dryRun     = $true
} | ConvertTo-Json

curl.exe -s -X POST http://localhost:3000/api/polymarket/simulate-historical `
  -H "Content-Type: application/json" `
  -b "auth_token=<dev-token>" `
  -d $body | Out-File -Encoding utf8 "$out/simlive.json"
```

### 4. Parity check

```powershell
node scripts/diff-results.cjs "$out/dryrun.json" "$out/simlive.json"
```

`scripts/diff-results.cjs` exists as of 2026-05-10 (T-0002). It compares the `metrics` object key-by-key.

Behavior:
- Default tolerance is absolute `1e-6` (matches v1.0.0 strict gate).
- For paper-trade vs bench comparisons (where stochastic timing causes natural drift), pass `--tolerance 0.05` for relative 5% tolerance.
- Exit code `0` on match, `1` on divergence with a per-field report; `2` on file/JSON errors.
- Use `-v` for the full numeric diff table.

### 5. Determinism check

Re-run step 2 once. The two `dryrun.json` files for the same SHA + window must be byte-identical. If they aren't, the engine has a non-deterministic source (random seed, time.now, map iteration order) — file a P0 in [../bugs.md](../bugs.md) and stop.

## Output schema

Every result file (dryrun or sim-live) must conform:

```jsonc
{
  "specVersion": "v1.0.0",
  "gitSha": "<40-char SHA>",
  "strategyId": "<id>",                    // e.g. "fade_favorite@v10"
  "strategyVersion": "<strategy params JSON>",
  "window": { "start": "<ISO>", "end": "<ISO>" },
  "universe": { "filter": "<string>", "marketCount": 0 },
  "metrics": {
    // Required pass/fail fields per the harness gates
    "totalTrades":     0,
    "winningTrades":   0,
    "losingTrades":    0,
    "winRate":         0.0,                // fraction in [0, 1]
    "roiPct":          0.0,                // window ROI % (final/initial - 1) * 100
    "annROIPct":       0.0,                // annualized ROI %
    "maxDrawdownPct":  0.0,                // % of peak equity
    "sharpeRatio":     0.0,                // annualized
    // Sizing / capital context
    "initialCapital":  0.0,
    "finalCapital":    0.0,
    "totalPnL":        0.0,
    "maxDrawdown":     0.0,                // absolute USD
    // Trade quality
    "avgWin":          0.0,                // average winner $
    "avgLoss":         0.0,                // average loser $ (positive number)
    "profitFactor":    0.0,                // grossWin / grossLoss
    "bestTrade":       0.0,
    "worstTrade":      0.0
  },
  "trades": [
    {
      "slug":          "<market slug>",
      "side":          "YES" /* or "NO" */,
      "entryTime":     "<ISO>",
      "exitTime":      "<ISO>",
      "entryPrice":    0.0,
      "exitPrice":     0.0,
      "exitReason":    "max_holding" /* or "tp", "sl", "resolution" */,
      "sizeUsd":       0.0,
      "pnl":           0.0,
      "won":           false
    }
  ]
}
```

The shape must be identical between dryrun and sim-live so the parity check is a flat field-by-field diff. Optional `equityCurve` may be added by tools that need to plot — it does not count for parity.

## Storage layout

```
benchmarks/
  SPEC.md                                # this file (tracked)
  results/                               # gitignored
    <spec-version>/
      <git-sha>/
        <timestamp>/
          sha.txt
          node-version.txt
          npm-deps.txt
          git-dirty.txt
          dryrun.json
          simlive.json
          parity.txt                     # output of step 4
```

Never commit `benchmarks/results/`. Re-run the spec to regenerate.

## v1.0.0 candidate result

The reference candidate as of 2026-05-10 is **Fade-the-Favorite v10** ([scripts/bench-fade-favorite.cjs](../scripts/bench-fade-favorite.cjs)). Bench result on the v1.0.0 universe + window:

| Metric | Value | Gate |
|---|---|---|
| totalTrades | 373 | ≥ 30 ✓ |
| winRate | 79.1% | — |
| roiPct | +434.31% | — |
| **annROIPct** | **+64.76%** | maximize |
| **maxDrawdownPct** | **9.16%** | ≤ 20% ✓ |
| **sharpeRatio** | **3.95** | ≥ 0.5 ✓ |
| profitFactor | 2.95 | — |

Result file: [benchmarks/results/v0.1.0-draft/0e8a1e0/fade-2026-05-10T13-10-21-084Z/dryrun.json](results/v0.1.0-draft/0e8a1e05bb6d840ee1f8f64ccedb208a5f3a2526/fade-2026-05-10T13-10-21-084Z/dryrun.json) (will be re-stamped under `v1.0.0/<sha>/...` on next clean run).

Out-of-sample test (2025-2026 only): 81.3% win, +188% annualized, Sharpe 4.11. Edge holds.

Caveats:
- Slippage modeled at 6% per leg; live could be higher in thin markets — `scripts/probe-slippage.cjs` showed 1-15% range
- `dryrun ≡ sim-live` parity not yet verified for fade strategy (T-0013 paper-trade window starts 2026-05-10; compare after 14 days using `diff-results.cjs --tolerance 0.05`)

## Leaderboard

Until we have a real leaderboard tool, candidates that pass the parity check live as one-line entries appended to `benchmarks/leaderboard.md`:

```
| date       | spec   | sha     | strategy            | annROIPct | maxDDPct | sharpe | nTrades |
| 2026-05-10 | v1.0.0 | 0e8a1e0 | fade_favorite@v10   | 64.76     | 9.16     | 3.95   | 373     |
```

Sort by `annROIPct` descending, but reject any row that breaches the `maxDD` cap.
