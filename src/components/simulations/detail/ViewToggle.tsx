"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ViewToggle({
  value,
  onChange,
}: {
  value: "dashboard" | "markets"
  onChange: (v: "dashboard" | "markets") => void
}) {
  return (
    <div className="flex items-center rounded-md border bg-card p-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-8 px-3", value === "dashboard" && "bg-secondary")}
        onClick={() => onChange("dashboard")}
      >
        Dashboard
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn("h-8 px-3", value === "markets" && "bg-secondary")}
        onClick={() => onChange("markets")}
      >
        Market cards
      </Button>
    </div>
  )
}

