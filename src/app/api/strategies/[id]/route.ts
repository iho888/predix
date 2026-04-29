import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const strategy = await prisma.strategy.findFirst({
    where: { id: params.id, userId: session.id },
  })
  if (!strategy) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.strategy.update({ where: { id: params.id }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
