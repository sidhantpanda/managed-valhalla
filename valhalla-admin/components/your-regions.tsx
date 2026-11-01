'use client'

import { Plus, RefreshCw, Undo2, X } from 'lucide-react'
import type { AdminState } from '@/lib/types'
import { formatAgo, formatBytes } from '@/lib/format'

type Props = {
  state: AdminState
  now: number
  busy: boolean
  onRemove: (id: string) => void
  onUndo: (id: string, wasAdd: boolean) => void
  onApply: () => void
  onDiscard: () => void
  onRefresh: () => void
}

export function YourRegions({ state, now, busy, onRemove, onUndo, onApply, onDiscard, onRefresh }: Props) {
  const { regions, pending, job } = state
  const building = job?.status === 'running'
  const hasChanges = pending.add.length > 0 || pending.remove.length > 0
  const remaining = regions.filter((region) => !pending.remove.includes(region.id)).length + pending.add.length
  const downloadBytes = pending.add.reduce((sum, added) => sum + (added.bytes ?? 0), 0)
  const sizesKnown = pending.add.every((added) => added.bytes)

  return (
    <section aria-labelledby="regions-title">
      <div className="flex items-baseline justify-between gap-4 border-b-[1.5px] border-ink pb-2">
        <h2 id="regions-title" className="text-lg font-semibold">Regions Valhalla routes in</h2>
        {regions.length > 0 && !hasChanges && (
          <button
            onClick={onRefresh}
            disabled={busy || building}
            className="inline-flex items-center gap-1.5 text-sm text-water hover:underline disabled:opacity-50 disabled:no-underline"
            title="Downloads the latest OpenStreetMap data for every region and rebuilds"
          >
            <RefreshCw size={14} aria-hidden /> Update map data
          </button>
        )}
      </div>

      {regions.length === 0 && pending.add.length === 0 ? (
        <p className="py-6 text-sm text-ink-soft">No regions yet. Pick one from the list to give Valhalla something to route in.</p>
      ) : (
        <ul className="divide-y divide-rule">
          {regions.map((region) => {
            const removing = pending.remove.includes(region.id)
            return (
              <li key={region.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className={`map-label truncate text-base font-medium ${removing ? 'text-ink-soft line-through decoration-road decoration-2' : ''}`}>{region.name}</p>
                  <p className="text-xs text-ink-soft">{formatBytes(region.bytes)} of OpenStreetMap data, downloaded {formatAgo(region.downloadedAt, now)}</p>
                </div>
                {removing ? (
                  <button onClick={() => onUndo(region.id, false)} disabled={busy || building} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink disabled:opacity-50">
                    <Undo2 size={14} aria-hidden /> Keep
                  </button>
                ) : (
                  <button
                    onClick={() => onRemove(region.id)}
                    disabled={busy || building}
                    className="inline-flex items-center gap-1.5 text-sm text-road hover:underline disabled:opacity-50"
                    aria-label={`Remove ${region.name}`}
                  >
                    <X size={14} aria-hidden /> Remove
                  </button>
                )}
              </li>
            )
          })}
          {pending.add.map((added) => (
            <li key={added.id} className="flex items-center gap-4 py-3">
              <Plus size={16} className="shrink-0 text-water" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="map-label truncate text-base font-medium text-water">{added.name}</p>
                <p className="text-xs text-ink-soft">{building && job.regionIds.includes(added.id) ? 'Being added by the current build' : added.bytes ? `Downloads ${formatBytes(added.bytes)} when you apply changes` : 'Downloads when you apply changes'}</p>
              </div>
              <button onClick={() => onUndo(added.id, true)} disabled={busy || building} className="inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink disabled:opacity-50">
                <Undo2 size={14} aria-hidden /> Don&apos;t add
              </button>
            </li>
          ))}
        </ul>
      )}

      {hasChanges && (
        <div className="mt-2 border-t-[1.5px] border-ink pt-4">
          <p className="text-sm text-ink-soft">
            {remaining === 0
              ? 'Keep at least one region; Valhalla needs something to route in.'
              : `Applying ${pending.add.length ? `downloads ${sizesKnown ? formatBytes(downloadBytes) : 'the new regions'} and ` : ''}rebuilds the tiles for ${remaining} ${remaining === 1 ? 'region' : 'regions'}. Valhalla keeps serving the current tiles until the build finishes.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              onClick={onApply}
              disabled={busy || building || remaining === 0}
              className="bg-water px-5 py-2.5 text-sm font-semibold text-sheet hover:brightness-110 disabled:opacity-50"
            >
              {building ? 'Wait for the current build' : 'Apply changes and rebuild'}
            </button>
            <button onClick={onDiscard} disabled={busy || building} className="px-3 py-2.5 text-sm text-ink-soft hover:text-ink disabled:opacity-50">
              Discard changes
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
