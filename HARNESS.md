# Predix Harness

The harness is the operating contract for any agent (human or Claude) working in this repo. Read this before starting work.

## Mission

Find a **high-return, low max-drawdown** strategy that we can deploy from **HK** to bet on Polymarket and kaishi prediction markets. Everything in this repo — sim engine, ingestion, UI, scripts — exists to support that goal.

Success criteria for a candidate strategy (see [benchmarks/SPEC.md](benchmarks/SPEC.md) for exact thresholds):

- Annualized return is the maximize target.
- Max drawdown is the constraint — a strategy that breaks the cap is rejected regardless of return.
- `nTrades >= 30` to avoid lucky-streak artifacts.
- `dryrun` and `sim-live` results must match within tolerance (otherwise the strategy is not real, only an in-sim mirage).

## Model

Pinned to **Claude Opus 4.7** via OAuth. The recommended `.claude/settings.json` is in [Recommended settings](#recommended-claudesettingsjson) below — paste it in manually (the harness setup couldn't write to that file directly).

## Content sources, ranked by trust

1. **This repo** — code and scripts under [src/](src/) and [scripts/](scripts/). Authoritative.
2. **Polymarket data we ingested** — [PolymarketMarket](prisma/schema.prisma) + `PolymarketPriceCandle` rows. Authoritative for prices and outcomes within the ingested window.
3. **polymarket.com APIs** — Gamma ([src/lib/polymarket/gamma.ts](src/lib/polymarket/gamma.ts)) and CLOB ([src/lib/polymarket/clob.ts](src/lib/polymarket/clob.ts)). Source of truth for live data.
4. **kaishi** — TBD; integration not yet written. Track work in [tasks.md](tasks.md).
5. **Web research** — fundamentals, news, market microstructure. Use `WebFetch` / `WebSearch`. Cite the URL whenever a research finding lands in code or a strategy.

## Context management

The single hardest thing in this repo is keeping the **benchmark** stable across sessions. Treat the benchmark + its exact reproduction command + its version pin as a unit:

- **One spec** — [benchmarks/SPEC.md](benchmarks/SPEC.md). It must contain the exact command, the git SHA pin, and the data window.
- **Versioned results** — drop each run under `benchmarks/results/<benchmark-version>/<git-sha>/` (gitignored; regenerable).
- **No untracked benchmark variants** — if the spec changes, bump the version in `benchmarks/SPEC.md` first, then re-run.

State files (read at the start of every session, write throughout):

- [tasks.md](tasks.md) — pending tasks. Add new tasks at the top, move done items to the Done section.
- [bugs.md](bugs.md) — unfixed bugs only. When fixed, move to Resolved with a 1-line note + commit SHA.

Knowledge graph: we use **graphify** for codebase navigation. Output lives in `graphify-out/` (gitignored). After non-trivial code changes, regenerate:

```powershell
# from repo root, in Claude Code
/graphify
```

Use [graphify-out/GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md) as the navigation index — the community hubs are the fastest way to find related code without re-reading the whole tree.

## Security

These are hard rules. Do not negotiate around them.

- **Never commit** `.env*`, `db_pwd.txt`, `*.log`, `secrets/`, `*.pem`, `*.key`, `graphify-out/`, `benchmarks/results/`, `.claude/settings.local.json`. The [.gitignore](.gitignore) covers these — do not weaken it.
- **Never echo or paste credentials** into chat output, commit messages, PR bodies, or test fixtures. If you need a connection string at runtime, source it from `.env`. Never inline a password in code, scripts, or `.claude/settings*.json`.
- **DATABASE_URL must come from `.env`** — not from a Bash permission rule, not hardcoded in scripts, not in settings files.
- **Historic data must be clean** — no duplicate `(marketSlug, timestamp)` rows in `PolymarketPriceCandle`. The composite PK in [prisma/schema.prisma](prisma/schema.prisma) enforces this; do not add backdoor inserts that bypass it.
- **dryrun ≡ sim-live** — any divergence is a P0 bug. File it in [bugs.md](bugs.md) and stop deploying until resolved.
- **No permission prompt for non-credential work.** Reading source, running sims, editing code, and committing source changes all proceed without asking. Touching `.env*`, `db_pwd.txt`, `secrets/`, or anything that could exfiltrate credentials always asks first — these are denied in [.claude/settings.json](.claude/settings.json).

## Workflow per session

1. Read [tasks.md](tasks.md) and [bugs.md](bugs.md).
2. Pick or take a task.
3. Use [graphify-out/GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md) to navigate before grepping.
4. Make changes. If they touch sim or strategy code, run the benchmark per [benchmarks/SPEC.md](benchmarks/SPEC.md).
5. Confirm `dryrun` and `sim-live` match.
6. Update [tasks.md](tasks.md) and [bugs.md](bugs.md). Commit. If the change is structural, regenerate graphify.

## Recommended `.claude/settings.json`

Paste this manually — the agent harness blocks self-modification of its own permission file.

```json
{
  "model": "claude-opus-4-7",
  "permissions": {
    "allow": [
      "Bash(*)",
      "Read(*)",
      "Edit(*)",
      "Write(*)",
      "Glob(*)",
      "Grep(*)",
      "WebFetch(*)",
      "WebSearch(*)"
    ],
    "deny": [
      "Read(./.env)",
      "Read(./.env.local)",
      "Read(./.env*.local)",
      "Read(./db_pwd.txt)",
      "Read(./secrets/**)",
      "Read(./*.pem)",
      "Read(./*.key)",
      "Read(./.claude/settings.local.json)",
      "Bash(cat .env*)",
      "Bash(cat ./.env*)",
      "Bash(cat db_pwd.txt)",
      "Bash(cat ./db_pwd.txt)",
      "Bash(type .env*)",
      "Bash(type db_pwd.txt)",
      "Bash(Get-Content .env*)",
      "Bash(Get-Content db_pwd.txt)",
      "Bash(git add .env*)",
      "Bash(git add ./.env*)",
      "Bash(git add db_pwd.txt)",
      "Bash(git add ./db_pwd.txt)",
      "Bash(git add secrets/*)",
      "Bash(git add -A*)",
      "Bash(git add .*)",
      "Bash(git add --all*)"
    ]
  }
}
```

Also: the existing [.claude/settings.local.json](.claude/settings.local.json) embeds a Neon DATABASE_URL with the password in plaintext as a Bash allow rule. Replace it with `Bash(npx prisma *)` and let `.env` supply `DATABASE_URL` at runtime. The file is now gitignored so the leak doesn't reach the remote, but it still sits on disk — rotate that password if anything else has touched it.

## Files in the harness

| File | Purpose |
|------|---------|
| [HARNESS.md](HARNESS.md) | This file. The contract. |
| [CLAUDE.md](CLAUDE.md) | Project conventions (stack, models, patterns). |
| [tasks.md](tasks.md) | Pending tasks. |
| [bugs.md](bugs.md) | Open bugs. |
| [benchmarks/SPEC.md](benchmarks/SPEC.md) | Benchmark spec — command, version, output schema. |
| [graphify-out/GRAPH_REPORT.md](graphify-out/GRAPH_REPORT.md) | Codebase navigation index (regenerable). |
| [.gitignore](.gitignore) | Secret/log/output exclusions. |
| [.claude/settings.json](.claude/settings.json) | Model pin + permission rules. |
