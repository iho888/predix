import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { signToken, buildUserSession, COOKIE_NAME_EXPORT } from "@/lib/auth"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { addDays } from "date-fns"

const schema = z.object({
  name: z.string().min(2).max(60),
  email: z.string().email(),
  password: z.string().min(8),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, email, password } = schema.parse(body)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const trialDays = parseInt(process.env.TRIAL_DAYS ?? "14")

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        trialEndsAt: addDays(new Date(), trialDays),
        subscriptionStatus: "TRIAL",
      },
    })

    const session = buildUserSession(user)
    const token = await signToken(session)

    const res = NextResponse.json({ user: session }, { status: 201 })
    res.cookies.set(COOKIE_NAME_EXPORT, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    })
    return res
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error(err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
