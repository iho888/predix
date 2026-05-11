# Bugs

Unfixed bugs only. When resolved, move to **Resolved** with date + commit SHA + 1-line note. Do not delete — the trail helps avoid regressions.

## Format

```
- [ ] B-<id>: <one-line title>
      Severity: P0 | P1 | P2
      Repro: <minimal command sequence>
      Expected: <what should happen>
      Actual: <what does happen>
      Notes: <links, hypotheses, related code>
```

`P0` = blocks deployment from HK or breaks the dryrun/sim-live invariant. `P1` = wrong numbers but not blocking. `P2` = quality / UX.

## Open

- [ ] B-0001: dryrun vs sim-live parity is unverified.
      Severity: P0 (until verified)
      Repro: TBD — needs T-0002 from `tasks.md` to be implemented before this can be reproduced or refuted.
      Expected: Identical metrics within 1e-6 across the same strategy + window.
      Actual: Unknown. Listed as P0 because the harness mission depends on this being true.
      Notes: Tracked together with T-0002.

- [ ] B-0002: Prisma 5.16 native engine segfaults on Node 24 (Windows).
      Severity: P2 (workaround in place)
      Repro: `npx prisma db pull --print` or any Prisma Client query → exits with `0xC0000005` (STATUS_ACCESS_VIOLATION) before any auth check.
      Expected: Engine starts, query runs.
      Actual: Schema engine RPC server fails to launch; native binding crashes.
      Notes: Existing `.cjs` scripts already work around this by using the `postgres` package directly (see `scripts/ingest-historic.cjs:2`). Real fix is to upgrade Prisma to 5.20+ or pin Node to v20 LTS. Until then, do NOT use Prisma Client in new scripts on this Windows env.

- [ ] B-0004: Default `defaultResolutionSniperParams` is a losing config on real data.
      Severity: P1
      Repro: `node --env-file=.env scripts/bench-resolution-sniper.cjs` over 2023-01-01..2024-12-30.
      Expected: per template description, "90%+ markets resolved correctly 100% of the time" → positive ROI, low DD.
      Actual: 24 trades, 66.7% win rate, ROI -17.98%, maxDD 25.53%, Sharpe -2.14. Losers are all early-lifecycle entries (Biden-wins markets, LayerZero airdrop, Fed cuts, weed rescheduling) where price was high months out and crashed when narrative flipped.
      Notes: The defaults set `endWithinDays: null` and a wide [0.80, 0.97] band. The template description claims an evidence base from 2024 calibration, but the calibration was for entries near resolution, not at any time. Two fixes: (a) tighten defaults to `endWithinDays: 30, minPrice: 0.85, maxPrice: 0.95`, or (b) rewrite description to be honest about regime risk. See src/lib/strategy-templates/index.ts:153-164 and the calibration in scripts/recalibrate-unique.cjs.

- [ ] B-0005: Daily sync silently misses all new markets — `runDailySync` has no discovery step.
      Severity: P1 (data-staleness; not blocking dryrun/sim-live parity but blocks any post-2024 strategy work)
      Repro: Inspect [src/lib/sync/run-daily-sync.ts:81-88](src/lib/sync/run-daily-sync.ts#L81-L88) — `prisma.polymarketMarket.findMany` is the only source of slugs. There is no call to `ingestMarketsFromGamma` or any equivalent that pages `/markets` from Gamma. Result: a market that closed in 2025-Q3 and was never in our DB stays unknown forever.
      Expected: Cron run discovers + ingests new Gamma markets, then refreshes known ones.
      Actual: Cron run only refreshes already-known markets. DB max(endDate) = 2024-12-30 even though today is 2026-05-08.
      Notes: Compounding issue — `vercel.json` has `/api/cron/sync-polymarket` scheduled `0 3 * * *`, but DataSyncLog has zero `syncType='cron'` rows across 22 entries (all `historic-cli`). The route returns 401 *before* writing a log row when CRON_SECRET is missing/wrong, so we have no signal whether it's a deploy issue, a secret issue, or the app is no longer on Vercel. Tracked together as T-0011.

- [ ] B-0003: `scripts/check-state.cjs` calls `pg_size_pretty()` which CockroachDB does not implement.
      Severity: P2
      Repro: `node scripts/check-state.cjs` → "unknown function: pg_size_pretty()" after first two queries succeed.
      Expected: All four queries print, script exits 0.
      Actual: Third query throws, script exits 1. Earlier queries still produce output, so the script is still useful as a connectivity check.
      Notes: Replace with `SHOW RANGES FROM DATABASE defaultdb` or compute size from `crdb_internal.ranges` for CRDB compatibility.

## Resolved

- B-pre-0001 — fixed 2026-05-08 (predates harness, in `3c11350` or nearby) — Simulation form defaulted to "last 90 days" (Feb–May 2026) but DB coverage ended Dec 30, 2024, so every run produced 0 trades. Page now fetches DB coverage range on load and auto-sets dates to 6 months ending at the latest market date; DB replay tab now displays the actual coverage window.
- B-pre-0002 — fixed 2026-05-08 (predates harness) — `isBondPolymarketStrategy` only matched `high_probability_bond`, so Resolution Sniper strategies hit the blocking warning and were missing from the dropdown. Updated to recognize both templates.
- B-pre-0003 — fixed 2026-05-08 (predates harness) — CockroachDB returns integer columns as JS strings, so `winningOutcomeIndex === 0` strict-equality always failed and every trade exited at the wrong price. Fixed with `Number()` coercion in `exitPriceForSide`. **Note for future ingestion code:** any integer column read from CockroachDB needs explicit numeric coercion before strict comparison.
