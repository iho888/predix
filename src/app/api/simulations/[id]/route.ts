import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sim = await prisma.simulation.findFirst({
    where: { id: params.id, userId: session.id },
    include: { strategy: { select: { name: true, platform: true, config: true } } },
  })
  if (!sim) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json({
    ...sim,
    metrics: sim.metricsJson ? JSON.parse(sim.metricsJson) : null,
    trades: sim.tradesJson ? JSON.parse(sim.tradesJson) : [],
  })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sim = await prisma.simulation.findFirst({
    where: { id: params.id, userId: session.id },
  })
  if (!sim) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.simulation.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
