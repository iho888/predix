// scripts/diff-results.cjs — sim-live ↔ dryrun parity check (T-0002, B-0001).
//
// Usage:
//   node scripts/diff-results.cjs <pathA.json> <pathB.json> [--tolerance 0.01]
//
// Loads two bench-result JSONs (each conforming to the shape produced by
// scripts/bench-fade-favorite.cjs, scripts/bench-resolution-sniper.cjs, or
// scripts/export-paper-positions.cjs), compares the `metrics` object key-by-key,
// and exits non-zero on any per-metric divergence beyond the tolerance.
//
// Tolerance defaults to 1e-6 (HARNESS spec). For comparing paper-trade results
// to a backtest (where stochastic effects of timing differ), pass a wider
// tolerance like --tolerance 0.05 (5% relative error).
"use strict"
const fs = require("fs")
const path = require("path")

function parseArgs(argv) {
  const positional = []
  let tolerance = 1e-6
  let mode = "absolute"  // "absolute" or "relative"
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--tolerance" && argv[i + 1]) { tolerance = Number(argv[++i]); mode = "relative" }
    else if (a === "--abs-tolerance" && argv[i + 1]) { tolerance = Number(argv[++i]); mode = "absolute" }
    else if (a === "--verbose" || a === "-v") { verbose = true }
    else if (a.startsWith("--")) { console.error(`Unknown flag: ${a}`); process.exit(2) }
    else { positional.push(a) }
  }
  if (positional.length !== 2) {
    console.error("Usage: node scripts/diff-results.cjs <a.json> <b.json> [--tolerance N | --abs-tolerance N] [-v]")
    process.exit(2)
  }
  return { pathA: positional[0], pathB: positional[1], tolerance, mode, verbose }
}

function loadJson(p) {
  const abs = path.resolve(p)
  if (!fs.existsSync(abs)) { console.error(`Not found: ${abs}`); process.exit(2) }
  try { return JSON.parse(fs.readFileSync(abs, "utf8")) }
  catch (e) { console.error(`Bad JSON in ${abs}: ${e.message}`); process.exit(2) }
}

function isNumeric(x) { return typeof x === "number" && Number.isFinite(x) }

function divergence(a, b, mode) {
  const diff = a - b
  if (mode === "absolute") return { abs: Math.abs(diff), rel: null }
  const denom = Math.max(Math.abs(a), Math.abs(b), 1e-12)
  return { abs: Math.abs(diff), rel: Math.abs(diff) / denom }
}

;(async () => {
  const { pathA, pathB, tolerance, mode, verbose } = parseArgs(process.argv.slice(2))

  const a = loadJson(pathA)
  const b = loadJson(pathB)

  const ma = a.metrics
  const mb = b.metrics
  if (!ma || typeof ma !== "object") { console.error(`No \`metrics\` object in ${pathA}`); process.exit(2) }
  if (!mb || typeof mb !== "object") { console.error(`No \`metrics\` object in ${pathB}`); process.exit(2) }

  const allKeys = new Set([...Object.keys(ma), ...Object.keys(mb)])
  const failures = []
  const numericRows = []

  for (const k of [...allKeys].sort()) {
    const va = ma[k]
    const vb = mb[k]
    if (isNumeric(va) && isNumeric(vb)) {
      const d = divergence(va, vb, mode)
      const ok = mode === "absolute"
        ? d.abs <= tolerance
        : (d.rel ?? Infinity) <= tolerance
      numericRows.push({ key: k, a: va, b: vb, abs: d.abs, rel: d.rel, ok })
      if (!ok) failures.push({ k, va, vb, d })
    } else if (verbose) {
      console.log(`  (skip non-numeric: ${k})`)
    }
  }

  console.log(`Parity check: ${path.basename(pathA)}  vs  ${path.basename(pathB)}`)
  console.log(`Tolerance: ${tolerance} (${mode})\n`)

  if (verbose) {
    console.table(numericRows.map(r => ({
      metric: r.key,
      A: r.a,
      B: r.b,
      abs_diff: r.abs.toExponential(3),
      rel_diff: r.rel != null ? (r.rel * 100).toFixed(3) + "%" : "—",
      ok: r.ok ? "✓" : "✗",
    })))
  }

  if (failures.length === 0) {
    console.log(`✅ All ${numericRows.length} numeric metric(s) within tolerance.`)
    process.exit(0)
  } else {
    console.log(`❌ ${failures.length} of ${numericRows.length} metric(s) diverge beyond tolerance:`)
    for (const f of failures) {
      const relStr = f.d.rel != null ? `, rel=${(f.d.rel * 100).toFixed(2)}%` : ""
      console.log(`  ${f.k}: A=${f.va}, B=${f.vb}, abs=${f.d.abs}${relStr}`)
    }
    process.exit(1)
  }
})().catch(e => { console.error("FAIL", e.message); process.exit(2) })
