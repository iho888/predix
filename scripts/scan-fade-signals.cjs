// Live Fade-the-Favorite signal scanner. Runs against Polymarket Gamma + CLOB
// in real time and emits the markets where the strategy WOULD enter today.
// Use this for paper trading and to validate sim-live ≡ dryrun parity (T-0002).
//
// Strategy spec (v10, slippage-modeled):
//   - Entry: NO side when YES price ∈ [0.50, 0.60], TTR ≥ 120 days
//   - Volume floor: 25,000  (filters out illiquid markets that bench-probed at 10%+ slippage)
//   - Spread filter: bestAsk - bestBid <= 0.03 on the NO token (live execution)
//   - Depth filter: ≥ $200 of liquidity at best ask
//   - Position size: 2% of cash per trade, max 100 concurrent
//   - Exit: +14 days (mark-to-market) or resolution, whichever first
"use strict"

const CLOB_BASE = (process.env.CLOB_BASE_URL || "https://clob.polymarket.com").replace(/\/+$/, "")
const GAMMA_BASE = (process.env.GAMMA_BASE_URL || "https://gamma-api.polymarket.com").replace(/\/+$/, "")

const PARAMS = {
  leaderMinPrice: 0.50,
  leaderMaxPrice: 0.60,
  minTtrDays: 120,
  minLiquidityNum: 1000,
  minVolumeNum: 25000,
  maxSpread: 0.03,            // skip markets where the NO ask-bid > 3¢
  minDepthAtBestAskUsd: 200,  // require ≥ $200 of liquidity at best NO ask
  positionSizeUsd: 50,        // tiny live positions to start
  expectedHoldDays: 14,
}

function parseJsonArrayMaybe(raw) {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return []
}

async function fetchGammaActiveMarkets(maxToFetch = 3000) {
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

async function fetchBook(tokenId) {
  try {
    const res = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`,
      { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

function bestPriceAndDepthUsd(orders, isAsk) {
  if (!Array.isArray(orders) || orders.length === 0) return null
  // Asks: lowest price first. Bids: highest price first.
  const sorted = orders.slice().sort((a, b) => isAsk ? Number(a.price) - Number(b.price) : Number(b.price) - Number(a.price))
  const top = sorted[0]
  const price = Number(top.price), shares = Number(top.size)
  if (!Number.isFinite(price) || !Number.isFinite(shares) || price <= 0 || shares <= 0) return null
  return { price, shares, usd: price * shares }
}

;(async () => {
  console.log(`Fade-the-Favorite live signal scan @ ${new Date().toISOString()}`)
  console.log(`Strategy: NO bet when YES ∈ [${PARAMS.leaderMinPrice}, ${PARAMS.leaderMaxPrice}], TTR ≥ ${PARAMS.minTtrDays}d, vol ≥ ${PARAMS.minVolumeNum.toLocaleString()}`)
  console.log(`Live filters: spread ≤ ${PARAMS.maxSpread}, depth ≥ \$${PARAMS.minDepthAtBestAskUsd}`)
  console.log()

  const now = new Date()
  const minEndMs = now.getTime() + PARAMS.minTtrDays * 86400000

  console.log("Fetching active markets from Gamma…")
  const markets = await fetchGammaActiveMarkets(3000)
  console.log(`  ${markets.length} fetched`)

  const inBand = []
  for (const m of markets) {
    const endDate = m.endDate || m.endDateIso
    if (!endDate) continue
    const endMs = new Date(endDate).getTime()
    if (!Number.isFinite(endMs) || endMs < minEndMs) continue
    const liq = Number(m.liquidityNum)
    const vol = Number(m.volumeNum)
    if (Number.isFinite(liq) && liq < PARAMS.minLiquidityNum) continue
    if (Number.isFinite(vol) && vol < PARAMS.minVolumeNum) continue
    const tokenIds = parseJsonArrayMaybe(m.clobTokenIds)
    const prices = parseJsonArrayMaybe(m.outcomePrices).map(Number)
    if (tokenIds.length !== 2 || prices.length !== 2) continue
    if (m.neg_risk === true) continue
    const yesPrice = Number(prices[0])
    if (!(yesPrice >= PARAMS.leaderMinPrice && yesPrice <= PARAMS.leaderMaxPrice)) continue
    const ttrDays = (endMs - now.getTime()) / 86400000
    inBand.push({
      slug: String(m.slug ?? ""),
      question: String(m.question ?? ""),
      endDate, ttrDays,
      liquidityNum: liq, volumeNum: vol,
      yesPrice,
      noTokenId: String(tokenIds[1] ?? "").trim(),
    })
  }
  console.log(`  ${inBand.length} pass strategy entry filters\n`)

  // Probe orderbooks
  console.log("Probing live NO-side orderbooks…\n")
  const tradeable = []
  const rejected = []
  for (const m of inBand) {
    if (!m.noTokenId) { rejected.push({ ...m, reason: "no NO token id" }); continue }
    const book = await fetchBook(m.noTokenId)
    if (!book) { rejected.push({ ...m, reason: "book fetch failed" }); continue }
    const ask = bestPriceAndDepthUsd(book.asks, true)
    const bid = bestPriceAndDepthUsd(book.bids, false)
    if (!ask) { rejected.push({ ...m, reason: "no asks (untradeable)" }); continue }
    if (!bid) { rejected.push({ ...m, reason: "no bids" }); continue }
    const spread = ask.price - bid.price
    if (spread > PARAMS.maxSpread) { rejected.push({ ...m, reason: `spread ${spread.toFixed(3)} > ${PARAMS.maxSpread}` }); continue }
    if (ask.usd < PARAMS.minDepthAtBestAskUsd) { rejected.push({ ...m, reason: `depth $${ask.usd.toFixed(0)} < $${PARAMS.minDepthAtBestAskUsd}` }); continue }
    tradeable.push({ ...m, bestAsk: ask.price, bestBid: bid.price, spread, depthUsdAtAsk: ask.usd })
  }

  console.log(`=== TRADEABLE SIGNALS (${tradeable.length}) ===`)
  if (tradeable.length > 0) {
    console.table(tradeable.map(m => ({
      slug: m.slug.slice(0, 50),
      yesNow: m.yesPrice.toFixed(3),
      ttrDays: Math.round(m.ttrDays),
      vol: Math.round(m.volumeNum).toLocaleString(),
      noBestAsk: m.bestAsk.toFixed(3),
      spread: m.spread.toFixed(3),
      depthUsd: "$" + Math.round(m.depthUsdAtAsk).toLocaleString(),
      action: `BUY \$${PARAMS.positionSizeUsd} NO @ ${m.bestAsk.toFixed(3)}`,
      planned_exit: `+${PARAMS.expectedHoldDays}d`,
    })))
  } else {
    console.log("  None right now.")
  }

  console.log(`\n=== REJECTED (${rejected.length}) — for diagnostic only ===`)
  if (rejected.length > 0) {
    console.table(rejected.slice(0, 20).map(m => ({
      slug: m.slug.slice(0, 50),
      yesNow: m.yesPrice?.toFixed(3) ?? "—",
      reason: m.reason,
    })))
  }

  console.log(`\nSummary: ${tradeable.length} tradeable signal(s), ${rejected.length} rejected`)
  console.log(`Next signal scan: run this script hourly (or wire to cron). Persist results to a paper-positions table when ready to validate sim-live ≡ dryrun.`)
})().catch(e => { console.error("FAIL", e.message, e.stack); process.exit(1) })
