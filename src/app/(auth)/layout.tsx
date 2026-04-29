import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  try {
    const session = await getSession()
    if (session) redirect("/dashboard")
  } catch {
    // If session check fails, just show the auth page
  }
  return <>{children}</>
}
