import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
  const latest = await prisma.dataSyncLog.findFirst({
    orderBy: { startedAt: "desc" },
  })
  return NextResponse.json({ latest })
}

