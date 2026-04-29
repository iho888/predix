"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Zap, ChevronDown, ChevronUp } from "lucide-react"
import type { StoredStrategyConfig, StrategyTemplateId } from "@/types"
import { defaultStoredConfig } from "@/lib/strategy-templates"
import { TemplatePicker, TemplateParamsForm } from "@/components/strategies/template-forms"
import { StrategyConfigSummary, TemplateBadge } from "@/components/strategies/strategy-summary"

interface StrategyRow {
  id: string
  name: string
  description?: string
  platform: string
  config: unknown
  createdAt: string
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [toast, setToast] = useState("")

  const [templateId, setTemplateId] = useState<StrategyTemplateId>("high_probability_bond")
  const [stored, setStored] = useState<StoredStrategyConfig>(() => defaultStoredConfig("high_probability_bond"))

  const [form, setForm] = useState({
    name: "",
    description: "",
    platform: "polymarket" as string,
  })

  function selectTemplate(id: StrategyTemplateId) {
    setTemplateId(id)
    setStored(defaultStoredConfig(id))
  }

  async function fetchStrategies() {
    const res = await fetch("/api/strategies")
    if (res.ok) setStrategies(await res.json())
  }

  useEffect(() => {
    fetchStrategies()
  }, [])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(""), 3000)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          platform: form.platform,
          config: { ...stored, version: 1 as const },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        return
      }
      setShowForm(false)
      setForm({ name: "", description: "", platform: "polymarket" })
      setTemplateId("high_probability_bond")
      setStored(defaultStoredConfig("high_probability_bond"))
      fetchStrategies()
      showToast("Strategy created successfully")
    } catch {
      setError("Failed to create strategy")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this strategy?")) return
    await fetch(`/api/strategies/${id}`, { method: "DELETE" })
    fetchStrategies()
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Strategies</h1>
          <p className="text-muted-foreground mt-1">Choose a template, tune parameters, and run simulations</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? <ChevronUp className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {showForm ? "Cancel" : "New strategy"}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="space-y-6">
          {error && (
            <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Create strategy</CardTitle>
              <CardDescription>Pick a template first, then set parameters. You can add more templates in code later.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    placeholder="e.g. March bond book"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Platform</Label>
                  <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="polymarket">Polymarket</SelectItem>
                      <SelectItem value="kaishi">Kaishi</SelectItem>
                      <SelectItem value="generic">Generic (both)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  placeholder="Short note for your list"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>

          <TemplatePicker
            templateId={templateId}
            onSelectTemplate={(id) => {
              setTemplateId(id)
              setStored(defaultStoredConfig(id))
            }}
          />

          <TemplateParamsForm stored={stored} onChange={setStored} />

          <Button type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create strategy"}
          </Button>
        </form>
      )}

      <div className="space-y-3">
        {strategies.length === 0 && !showForm ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Zap className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground mb-4">No strategies yet. Create one with a template above.</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" /> New strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          strategies.map((s) => (
            <Card key={s.id} className="glow-card">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold">{s.name}</h3>
                      <Badge platform={s.platform} />
                      <TemplateBadge config={s.config} />
                    </div>
                    {s.description && <p className="text-sm text-muted-foreground mb-3">{s.description}</p>}
                    <StrategyConfigSummary config={s.config} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label="Delete strategy"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}

function Badge({ platform }: { platform: string }) {
  return (
    <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
      {platform}
    </span>
  )
}
