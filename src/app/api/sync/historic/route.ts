import { NextRequest, NextResponse } from "next/server"
import { getSessionFromRequest } from "@/lib/auth"
import { fetchHistoricRange } from "@/lib/sync/fetch-historic-range"
import { z } from "zod"

export const runtime = "nodejs"
export const maxDuration = 300

const bodySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
  maxMarkets: z.number().int().min(1).max(500).optional(),
})

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const json = await req.json()
    const body = bodySchema.parse(json)

    const startDate = new Date(body.startDate + "T00:00:00Z")
    const endDate = new Date(body.endDate + "T23:59:59Z")

    if (startDate >= endDate) {
      return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 })
    }

    const result = await fetchHistoricRange({
      startDate,
      endDate,
      maxMarkets: body.maxMarkets ?? 500,
      syncType: "historic",
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : "Request failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
