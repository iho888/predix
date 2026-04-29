import { NextResponse } from "next/server"
import { COOKIE_NAME_EXPORT } from "@/lib/auth"

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(COOKIE_NAME_EXPORT)
  return res
}
