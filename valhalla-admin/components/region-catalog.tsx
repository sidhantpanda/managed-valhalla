'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Search, TriangleAlert } from 'lucide-react'
import type { AdminState, CatalogRegion } from '@/lib/types'

type Props = {
  regions: CatalogRegion[] | null
  error: string | null
  state: AdminState
  busy: boolean
  onAdd: (id: string) => void
}

type Status =
  | { kind: 'installed' }
  | { kind: 'adding' }
  | { kind: 'removing' }
  | { kind: 'included'; in: string }
  | { kind: 'available' }

const MAX_RESULTS = 60

export function RegionCatalog({ regions, error, state, busy, onAdd }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(() => new Set(['planet']))

  const { byId, children } = useMemo(() => {
    const byId = new Map<string, CatalogRegion>()
    const children = new Map<string, CatalogRegion[]>()
    for (const region of regions ?? []) {
      byId.set(region.id, region)
      if (region.parent) children.set(region.parent, [...(children.get(region.parent) ?? []), region])
    }
    return { byId, children }
  }, [regions])

  const selected = useMemo(() => {
    const ids = new Set(state.regions.filter((region) => !state.pending.remove.includes(region.id)).map((region) => region.id))
    for (const added of state.pending.add) ids.add(added.id)
    return ids
  }, [state])

  const pathOf = (region: CatalogRegion) => {
    const names: string[] = []
    let parent = region.parent ? byId.get(region.parent) : undefined
    while (parent && parent.id !== 'planet') {
      names.unshift(parent.name)
      parent = parent.parent ? byId.get(parent.parent) : undefined
    }
    return names.join(' / ')
  }

  const statusOf = (region: CatalogRegion): Status => {
    if (state.pending.add.some((added) => added.id === region.id)) return { kind: 'adding' }
    if (state.pending.remove.includes(region.id)) return { kind: 'removing' }
    if (selected.has(region.id)) return { kind: 'installed' }
    let parent = region.parent ? byId.get(region.parent) : undefined
    while (parent) {
      if (selected.has(parent.id)) return { kind: 'included', in: parent.name }
      parent = parent.parent ? byId.get(parent.parent) : undefined
    }
    return { kind: 'available' }
  }

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle || !regions) return null
    return regions.filter((region) => region.name.toLowerCase().includes(needle) || region.id.includes(needle)).slice(0, MAX_RESULTS)
  }, [query, regions])

  const toggle = (id: string) => setOpen((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const row = (region: CatalogRegion, depth: number, showPath: boolean) => {
    const kids = children.get(region.id) ?? []
    const expanded = open.has(region.id)
    const status = statusOf(region)
    return (
      <li key={region.id}>
        <div className="flex items-center gap-2 border-b border-rule py-2 pr-1" style={{ paddingLeft: showPath ? 0 : depth * 18 }}>
          {!showPath && kids.length > 0 ? (
            <button onClick={() => toggle(region.id)} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} regions in ${region.name}`} className="p-0.5 text-contour hover:text-ink">
              <ChevronRight size={16} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="map-label truncate text-[15px] font-medium">{region.name}</p>
            {showPath && pathOf(region) && <p className="truncate text-xs text-ink-soft">{pathOf(region)}</p>}
            {region.id === 'planet' && (
              <p className="flex items-center gap-1 text-xs text-road"><TriangleAlert size={12} aria-hidden /> Building it needs a machine with 64 GB of RAM or more</p>
            )}
          </div>
          <StatusAction status={status} name={region.name} busy={busy} onAdd={() => onAdd(region.id)} />
        </div>
        {!showPath && expanded && kids.length > 0 && <ul>{kids.map((kid) => row(kid, depth + 1, false))}</ul>}
      </li>
    )
  }

  return (
    <section aria-labelledby="catalog-title" className="flex min-h-0 flex-col">
      <div className="border-b-[1.5px] border-ink pb-2">
        <h2 id="catalog-title" className="text-lg font-semibold">Add a region</h2>
        <p className="text-sm text-ink-soft">OpenStreetMap extracts from Geofabrik. A region includes everything inside it.</p>
      </div>
      <label className="mt-3 flex items-center gap-2 border-[1.5px] border-rule bg-sheet px-3 py-2 focus-within:border-water">
        <Search size={16} className="text-contour" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search countries, states and provinces"
          aria-label="Search regions"
          className="w-full bg-transparent text-sm outline-none placeholder:text-contour"
        />
      </label>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
        {error && <p className="py-6 text-sm text-road">{error}</p>}
        {!error && !regions && <p className="py-6 text-sm text-ink-soft">Loading regions from Geofabrik…</p>}
        {regions && matches && (matches.length ? <ul>{matches.map((region) => row(region, 0, true))}</ul> : <p className="py-6 text-sm text-ink-soft">No region matches “{query.trim()}”.</p>)}
        {regions && !matches && <ul>{(children.get('planet') ? [byId.get('planet')!] : []).map((region) => row(region, 0, false))}</ul>}
      </div>
    </section>
  )
}

function StatusAction({ status, name, busy, onAdd }: { status: Status; name: string; busy: boolean; onAdd: () => void }) {
  switch (status.kind) {
    case 'installed':
      return <span className="shrink-0 text-xs text-ink-soft">Installed</span>
    case 'adding':
      return <span className="shrink-0 text-xs font-semibold text-water">Will be added</span>
    case 'removing':
      return <span className="shrink-0 text-xs text-road">Will be removed</span>
    case 'included':
      return <span className="shrink-0 text-right text-xs text-ink-soft">In {status.in}</span>
    default:
      return (
        <button
          onClick={onAdd}
          disabled={busy}
          aria-label={`Add ${name}`}
          className="inline-flex shrink-0 items-center gap-1 border-[1.5px] border-water px-2.5 py-1 text-xs font-semibold text-water hover:bg-water-tint disabled:opacity-50"
        >
          <Plus size={13} aria-hidden /> Add
        </button>
      )
  }
}
