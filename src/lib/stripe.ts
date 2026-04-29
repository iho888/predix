import Stripe from "stripe"

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "sk_test_placeholder", {
  apiVersion: "2024-06-20",
})

export const PLANS = {
  monthly: {
    priceId: process.env.STRIPE_PRICE_ID ?? "price_placeholder",
    name: "Predix Pro",
    price: 29,
    interval: "month" as const,
    features: [
      "Unlimited simulations",
      "All platforms (Polymarket, Kaishi, more)",
      "Advanced strategy builder",
      "Real-time metrics & analytics",
      "Export reports (CSV/PDF)",
      "Priority support",
    ],
  },
}
