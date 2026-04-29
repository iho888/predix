import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { NextRequest } from "next/server"
import { UserSession } from "@/types"
import { differenceInDays } from "date-fns"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "predix-fallback-secret"
)
const COOKIE_NAME = "predix_session"

export async function signToken(payload: UserSession): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<UserSession | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as UserSession
  } catch {
    return null
  }
}

export async function getSession(): Promise<UserSession | null> {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function getSessionFromRequest(req: NextRequest): Promise<UserSession | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export function buildUserSession(user: {
  id: string
  email: string
  name: string
  subscriptionStatus: string
  trialEndsAt: Date
}): UserSession {
  const trialDaysLeft = Math.max(0, differenceInDays(user.trialEndsAt, new Date()))
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    subscriptionStatus: user.subscriptionStatus as UserSession["subscriptionStatus"],
    trialEndsAt: user.trialEndsAt.toISOString(),
    trialDaysLeft,
  }
}

export function canAccessPlatform(session: UserSession): boolean {
  if (session.subscriptionStatus === "ACTIVE") return true
  if (session.subscriptionStatus === "TRIAL" && session.trialDaysLeft > 0) return true
  return false
}

export const COOKIE_NAME_EXPORT = COOKIE_NAME
