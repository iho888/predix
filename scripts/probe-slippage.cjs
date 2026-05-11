// Live orderbook slippage probe for Fade-the-Favorite signals.
//
// Pulls currently-active markets from our DB whose YES price is in the
// strategy's entry band (0.50-0.60) AND has TTR >= 120 days. For each,
// fetches the live Polymarket CLOB orderbook and computes the realistic NO-side
// buy fill price for a typical $50 order vs the mid-price assumed by the bench.
//
// Output: per-market and aggregate slippage estimates.
"use strict"

const CLOB_BASE = (process.env.CLOB_BASE_URL || "https://clob.polymarket.com").replace(/\/+$/, "")
const GAMMA_BASE = (process.env.GAMMA_BASE_URL || "https://gamma-api.polymarket.com").replace(/\/+$/, "")

const ENTRY_MIN = 0.50
const ENTRY_MAX = 0.60
const MIN_TTR_DAYS = 120
const ORDER_SIZE_USD = 50           // typical bench-sized order
const ORDER_SIZE_USD_BIG = 200      // late-cycle compounded order

function pickNoTokenId(clobTokenIdsJson) {
  if (clobTokenIdsJson == null) return null
  let arr = clobTokenIdsJson
  if (typeof arr === "string") {
    try { arr = JSON.parse(arr) } catch { return null }
  }
  if (!Array.isArray(arr) || arr.length < 2) return null
  // Outcome 0 = YES, Outcome 1 = NO. Token IDs are aligned by index.
  const s = String(arr[1] ?? "").trim()
  return s || null
}

async function fetchBook(tokenId) {
  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`,
      { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const data = await res.json()
    return data && typeof data === "object" ? data : null
  } catch { return null }
}

// Compute weighted average fill price for buying $sizeUsd at the asks.
// Asks come as [{price, size}, ...] sorted by price ascending.
function computeFillPrice(asks, sizeUsd) {
  if (!Array.isArray(asks) || asks.length === 0) return null
  // Polymarket book shape: bids/asks each is [{price, size}]
  let remaining = sizeUsd
  let cost = 0
  let shares = 0
  // Asks are usually sorted price ASC. Confirm.
  const sorted = asks.slice().sort((a, b) => Number(a.price) - Number(b.price))
  for (const lvl of sorted) {
    const price = Number(lvl.price)
    const lvlShares = Number(lvl.size)
    if (!Number.isFinite(price) || !Number.isFinite(lvlShares) || price <= 0 || lvlShares <= 0) continue
    const lvlUsd = price * lvlShares
    if (lvlUsd >= remaining) {
      const sharesNeeded = remaining / price
      cost += sharesNeeded * price
      shares += sharesNeeded
      remaining = 0
      break
    } else {
      cost += lvlUsd
      shares += lvlShares
      remaining -= lvlUsd
    }
  }
  if (remaining > 0) {
    // Insufficient depth for this order size
    return { fillPrice: null, sharesFilled: shares, costFilled: cost, shortfallUsd: remaining }
  }
  return { fillPrice: cost / shares, sharesFilled: shares, costFilled: cost, shortfallUsd: 0 }
}

async function fetchGammaActiveMarkets(maxToFetch = 2000) {
  const PAGE = 100
  const all = []
  for (let offset = 0; offset < maxToFetch && all.length < maxToFetch; offset += PAGE) {
    const p = new URLSearchParams({
      closed: "false", active: "true",
      limit: String(PAGE), offset: String(offset),
      order: "endDate", ascending: "false",
    })
    const res = await fetch(`${GAMMA_BASE}/markets?${p}`, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) break
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

function parseJsonArrayMaybe(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return []
}

;(async () => {
  console.log(`Loading active markets from Gamma API…`)
  const now = new Date()
  const minEndMs = now.getTime() + MIN_TTR_DAYS * 86400000
  const gammaMarkets = await fetchGammaActiveMarkets(2000)
  console.log(`  ${gammaMarkets.length} active markets fetched`)

  const inBand = []
  let filteredEndDate = 0, filteredTtr = 0, filteredLiqVol = 0, filteredShape = 0, filteredNegRisk = 0, filteredBand = 0
  let ttrSamples = []
  for (const m of gammaMarkets) {
    const endDate = m.endDate || m.endDateIso
    if (!endDate) { filteredEndDate++; continue }
    const endMs = new Date(endDate).getTime()
    if (!Number.isFinite(endMs)) { filteredEndDate++; continue }
    const ttrDays = (endMs - now.getTime()) / 86400000
    ttrSamples.push(ttrDays)
    if (endMs < minEndMs) { filteredTtr++; continue }
    const liq = Number(m.liquidityNum)
    const vol = Number(m.volumeNum)
    if (Number.isFinite(liq) && liq < 1000) { filteredLiqVol++; continue }
    if (Number.isFinite(vol) && vol < 5000) { filteredLiqVol++; continue }
    const outcomes = parseJsonArrayMaybe(m.outcomes)
    const tokenIds = parseJsonArrayMaybe(m.clobTokenIds)
    const prices = parseJsonArrayMaybe(m.outcomePrices).map(Number)
    if (outcomes.length !== 2 || tokenIds.length !== 2 || prices.length !== 2) { filteredShape++; continue }
    if (m.neg_risk === true) { filteredNegRisk++; continue }
    const yesPrice = Number(prices[0])
    if (!(yesPrice >= ENTRY_MIN && yesPrice <= ENTRY_MAX)) { filteredBand++; continue }
    inBand.push({
      slug: String(m.slug ?? ""),
      question: String(m.question ?? ""),
      endDate,
      liquidityNum: liq,
      volumeNum: vol,
      clobTokenIdsJson: tokenIds,
      lastYes: yesPrice,
    })
  }
  console.log(`  Filter funnel:`)
  console.log(`    no endDate:      ${filteredEndDate}`)
  console.log(`    TTR < ${MIN_TTR_DAYS}d:        ${filteredTtr}`)
  console.log(`    liq/vol floor:   ${filteredLiqVol}`)
  console.log(`    bad shape:       ${filteredShape}`)
  console.log(`    neg_risk:        ${filteredNegRisk}`)
  console.log(`    out of band:     ${filteredBand}`)
  console.log(`    in band:         ${inBand.length}`)
  if (ttrSamples.length > 0) {
    ttrSamples.sort((a, b) => a - b)
    const p10 = ttrSamples[Math.floor(ttrSamples.length * 0.1)]
    const p50 = ttrSamples[Math.floor(ttrSamples.length * 0.5)]
    const p90 = ttrSamples[Math.floor(ttrSamples.length * 0.9)]
    const max = ttrSamples[ttrSamples.length - 1]
    console.log(`  TTR distribution (days): p10 ${p10.toFixed(1)}, p50 ${p50.toFixed(1)}, p90 ${p90.toFixed(1)}, max ${max.toFixed(1)}`)
  }

  if (inBand.length === 0) {
    console.log("No live signals to probe right now. Try widening the band or relaxing TTR.")
    return
  }

  // Probe each market's NO-side orderbook
  const results = []
  for (const m of inBand.slice(0, 30)) {
    const noTokenId = pickNoTokenId(m.clobTokenIdsJson)
    if (!noTokenId) continue
    const book = await fetchBook(noTokenId)
    if (!book) {
      results.push({ slug: m.slug, error: "no book" })
      continue
    }

    const lastYes = Number(m.lastYes)
    const noMid = 1 - lastYes // approximation; we don't have YES book
    const asks = book.asks || []
    const bids = book.bids || []
    const bestAsk = asks.length > 0 ? Number(asks.reduce((a, b) => Number(a.price) < Number(b.price) ? a : b).price) : null
    const bestBid = bids.length > 0 ? Number(bids.reduce((a, b) => Number(a.price) > Number(b.price) ? a : b).price) : null

    const fill50 = computeFillPrice(asks, ORDER_SIZE_USD)
    const fill200 = computeFillPrice(asks, ORDER_SIZE_USD_BIG)

    const slippagePct50 = fill50?.fillPrice != null
      ? ((fill50.fillPrice - noMid) / noMid * 100)
      : null
    const slippagePct200 = fill200?.fillPrice != null
      ? ((fill200.fillPrice - noMid) / noMid * 100)
      : null

    results.push({
      slug: m.slug.slice(0, 50),
      yesPrice: lastYes.toFixed(3),
      noMid: noMid.toFixed(3),
      bestAsk: bestAsk?.toFixed(3) ?? "—",
      bestBid: bestBid?.toFixed(3) ?? "—",
      spread: bestAsk != null && bestBid != null ? (bestAsk - bestBid).toFixed(3) : "—",
      fill50: fill50?.fillPrice?.toFixed(3) ?? `short ${fill50?.shortfallUsd?.toFixed(0) ?? "?"}`,
      slipPct50: slippagePct50?.toFixed(1) ?? "—",
      fill200: fill200?.fillPrice?.toFixed(3) ?? `short ${fill200?.shortfallUsd?.toFixed(0) ?? "?"}`,
      slipPct200: slippagePct200?.toFixed(1) ?? "—",
    })
  }

  console.table(results)

  // Aggregate
  const slip50 = results.map(r => Number(r.slipPct50)).filter(n => Number.isFinite(n))
  const slip200 = results.map(r => Number(r.slipPct200)).filter(n => Number.isFinite(n))
  if (slip50.length > 0) {
    slip50.sort((a, b) => a - b)
    const median50 = slip50[Math.floor(slip50.length / 2)]
    const mean50 = slip50.reduce((s, x) => s + x, 0) / slip50.length
    console.log(`\n$50 order (n=${slip50.length}): mean slippage ${mean50.toFixed(2)}%, median ${median50.toFixed(2)}%`)
  }
  if (slip200.length > 0) {
    slip200.sort((a, b) => a - b)
    const median200 = slip200[Math.floor(slip200.length / 2)]
    const mean200 = slip200.reduce((s, x) => s + x, 0) / slip200.length
    console.log(`$200 order (n=${slip200.length}): mean slippage ${mean200.toFixed(2)}%, median ${median200.toFixed(2)}%`)
  }
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })
