import { redirect } from "next/navigation"

/** Polymarket dry run lives under Simulations → Polymarket tab. */
export default function SimulateRedirectPage() {
  redirect("/dashboard/simulations")
}
