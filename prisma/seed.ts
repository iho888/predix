import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10)
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)

  const user = await prisma.user.upsert({
    where: { email: "dev@predix.local" },
    update: {},
    create: {
      email: "dev@predix.local",
      name: "Dev User",
      passwordHash,
      trialEndsAt,
      subscriptionStatus: "TRIAL",
    },
  })

  await prisma.strategy.upsert({
    where: { id: "seed-strategy-hpb-001" },
    update: {},
    create: {
      id: "seed-strategy-hpb-001",
      userId: user.id,
      name: "Seed High-Prob Bond",
      platform: "polymarket",
      config: JSON.stringify({
        templateId: "high_probability_bond",
        version: 1,
        params: {
          minPrice: 0.80,
          maxPrice: 0.97,
          minLiquidityNum: 500,
          minVolumeNum: 1000,
          endWithinDays: 14,
          takeProfitPct: 3,
          stopLossPct: 15,
          maxHoldingDays: 14,
          positionSizePct: 5,
          maxOpenPositions: 10,
        },
      }),
    },
  })

  console.log(`Seeded user: ${user.email} (password: password123)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
