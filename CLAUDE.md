# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Read [HARNESS.md](HARNESS.md) first.** It defines the mission (high-return / low max-DD strategy for HK deployment), the benchmark contract, security rules, and the tasks/bugs workflow. CLAUDE.md is for stack and conventions; HARNESS.md is for what we're trying to accomplish and how we measure it.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Production build
npm run lint         # ESLint

npm run db:push      # Push Prisma schema changes to DB (no migration file)
npm run db:studio    # Open Prisma Studio GUI
npm run db:seed      # Seed database (prisma/seed.ts)
npm run db:ingest    # Ingest Polymarket data (scripts/ingest-polymarket.ts)
```

There are no automated tests configured in this project.

## Architecture

**Stack:** Next.js 14 App Router · Prisma + PostgreSQL · Tailwind CSS + Radix UI · Zustand · Stripe · JWT auth (jose)

### Route Groups

- `src/app/(auth)/` — Unauthenticated routes: `/login`, `/register`
- `src/app/(dashboard)/` — Protected routes requiring valid session: `/dashboard`, `/dashboard/strategies`, `/dashboard/simulations/[id]`, `/dashboard/simulate`, `/dashboard/live-apply`, `/dashboard/billing`
- `src/app/api/` — All API routes (REST, no tRPC)

### Core Business Logic (`src/lib/`)

| File | Purpose |
|------|---------|
| `auth.ts` | JWT signing/verification, cookie session, `canAccessPlatform()` gate |
| `db.ts` | Prisma singleton (dev-safe) |
| `simulation/engine.ts` | Backtest engine — tick-by-tick strategy evaluation, metrics calculation (Sharpe, drawdown, equity curve) |
| `polymarket-db-simulation.ts` | Simulation against stored Polymarket DB candles |
| `markets/polymarket-real.ts` | Live Polymarket data fetching |
| `polymarket/gamma.ts` | Gamma API client |
| `polymarket/clob.ts` | CLOB orderbook client |
| `sync/run-daily-sync.ts` | Orchestrates nightly market + candle ingestion |
| `strategies/registry.ts` | Strategy template definitions |
| `plans.ts` | Subscription plan config (TRIAL/ACTIVE/EXPIRED/CANCELLED) |
| `stripe.ts` | Stripe SDK init |

### Key Data Models

**User** — email/password auth, trial window (`trialEndsAt`), Stripe subscription fields.

**Strategy** — belongs to User, `config` stored as JSON string (`StrategyConfig` type), `platform` enum: `polymarket | kaishi | generic`.

**Simulation** — belongs to User + Strategy, `metricsJson` + `tradesJson` stored as JSON columns, `status`: `PENDING | RUNNING | COMPLETED | FAILED`.

**PolymarketMarket** — keyed by `slug`, stores outcomes/tokens as JSON. Related `PolymarketPriceCandle` records (one per `[marketSlug, timestamp]`).

**DataSyncLog** — audit trail for each market/candle sync run.

### Auth & Access Control

- Auth is cookie-based JWT (`auth_token` cookie, 7-day expiry, HS256).
- All protected API routes must call `getSession()` from `src/lib/auth.ts` and check `canAccessPlatform()` for subscription gating.
- `subscriptionStatus` drives feature access: `TRIAL` users have time-limited access, `EXPIRED`/`CANCELLED` are blocked.

### Strategy Config Shape

```ts
StrategyConfig {
  entryConditions: StrategyCondition   // field, operator, value
  exitConditions: ExitCondition        // takeProfitPct, stopLossPct, maxHoldingDays
  positionSizePct: number
  maxOpenPositions: number
  minOdds?: number
  maxOdds?: number
  endWithinDays?: number
}
```

### Environment Variables

See `.env.example` at root. Required:
- `DATABASE_URL` — Postgres (or SQLite for local dev)
- `JWT_SECRET` — min 32 chars
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`
- `NEXT_PUBLIC_APP_URL`
- `GAMMA_BASE_URL`, `CLOB_BASE_URL` — Polymarket API endpoints
- `CRON_SECRET` — protects `/api/cron/*` endpoints

### Patterns to Follow

- API routes use `export const dynamic = 'force-dynamic'` where needed to opt out of static caching.
- Prisma is imported from `@/lib/db` (not directly from `@prisma/client`).
- UI components in `src/components/ui/` are Radix UI wrappers styled with Tailwind; use them before reaching for raw HTML.
- `@/*` path alias maps to `src/*`.
- metricsJson / tradesJson are stored as raw JSON strings and parsed at read time — cast with the corresponding types from `src/types/index.ts`.
