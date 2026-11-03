'use client'

import { useCallback, useEffect, useState } from 'react'
import type { AdminState, CatalogRegion } from '@/lib/types'
import { formatAgo, formatBytes } from '@/lib/format'
import { BuildPanel } from './build-panel'
import { RegionCatalog } from './region-catalog'
import { YourRegions } from './your-regions'

// Poll fast while a build runs so the progress bar moves; slowly otherwise to notice Valhalla going up or down.
const FAST_POLL_MS = 1000
const SLOW_POLL_MS = 5000

export function AdminDashboard() {
  const [state, setState] = useState<AdminState | null>(null)
  const [stateError, setStateError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogRegion[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Set on every poll; the state it is used with arrives on the first one.
  const [now, setNow] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/state', { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setState(await response.json())
      setStateError(null)
    } catch {
      setStateError('The admin server is not answering. Check that the valhalla-admin container is running.')
    }
    setNow(Date.now())
  }, [])

  const running = state?.job?.status === 'running'
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, running ? FAST_POLL_MS : SLOW_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh, running])

  useEffect(() => {
    fetch('/api/catalog')
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error)
        setCatalog(body.regions)
      })
      .catch((error: Error) => setCatalogError(error.message || 'The region list could not be loaded.'))
  }, [])

  const send = async (url: string, init: RequestInit) => {
    setBusy(true)
    setActionError(null)
    try {
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) setActionError(body.error || `The request failed with HTTP ${response.status}.`)
      else setState(body)
    } catch {
      setActionError('The admin server is not answering. Try again.')
    } finally {
      setBusy(false)
      setNow(Date.now())
    }
  }
  const stage = (action: 'add' | 'remove' | 'clear', id?: string) => send('/api/pending', { method: 'POST', body: JSON.stringify({ action, id }) })

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3 border-b-[3px] border-double border-ink pb-4">
        <div>
          <h1 className="map-label text-4xl font-semibold leading-none sm:text-5xl">Valhalla regions</h1>
          <p className="mt-2 text-sm text-ink-soft">Choose the parts of the world Valhalla can route in.</p>
        </div>
        {state && <ServiceStatus state={state} now={now} />}
      </header>

      {stateError && <p role="alert" className="mt-6 border-l-[3px] border-road bg-road-tint px-3 py-2 text-sm">{stateError}</p>}
      {actionError && (
        <p role="alert" className="mt-6 flex items-start justify-between gap-4 border-l-[3px] border-road bg-road-tint px-3 py-2 text-sm">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-ink-soft hover:text-ink">Dismiss</button>
        </p>
      )}

      {!state && !stateError && <p className="mt-10 text-sm text-ink-soft">Loading…</p>}

      {state && (
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="space-y-10">
            {state.job && <BuildPanel job={state.job} now={now} busy={busy} onCancel={() => send('/api/build', { method: 'DELETE' })} />}
            <YourRegions
              state={state}
              now={now}
              busy={busy}
              onRemove={(id) => stage('remove', id)}
              onUndo={(id, wasAdd) => stage(wasAdd ? 'remove' : 'add', id)}
              onApply={() => send('/api/build', { method: 'POST', body: '{}' })}
              onDiscard={() => stage('clear')}
              onRefresh={() => send('/api/build', { method: 'POST', body: JSON.stringify({ refresh: true }) })}
            />
          </div>
          <div className="lg:sticky lg:top-6 lg:flex lg:h-[calc(100dvh-3rem)] lg:flex-col">
            <RegionCatalog regions={catalog} error={catalogError} state={state} busy={busy} onAdd={(id) => stage('add', id)} />
          </div>
        </div>
      )}
    </div>
  )
}

function ServiceStatus({ state, now }: { state: AdminState; now: number }) {
  const { valhalla, disk, job } = state
  const restarting = !valhalla.online && job?.status === 'succeeded' && job.finishedAt && now - new Date(job.finishedAt).getTime() < 60_000
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-sm">
      <dt className="text-ink-soft">Valhalla</dt>
      <dd className="flex items-center gap-2">
        <span aria-hidden className={`inline-block size-2.5 rounded-full ${valhalla.online ? 'bg-land ring-2 ring-land/40' : restarting ? 'bg-water' : 'bg-road'}`} />
        {valhalla.online
          ? `Routing, tiles built ${formatAgo(valhalla.tilesetBuiltAt, now)}`
          : restarting ? 'Restarting onto the new tiles' : valhalla.reason}
      </dd>
      <dt className="text-ink-soft">Storage</dt>
      <dd>{formatBytes(disk.freeBytes)} free of {formatBytes(disk.totalBytes)}, tiles use {formatBytes(disk.tilesBytes)}</dd>
    </dl>
  )
}
