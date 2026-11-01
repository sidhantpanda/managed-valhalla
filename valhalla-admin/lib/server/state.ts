import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CatalogRegion, InstalledRegion, PendingChanges } from '@/lib/types'
import { ancestorsOf, fileNameFor, getCatalog } from './catalog'
import { DATA_DIR, paths } from './config'

export type StoredState = {
  regions: InstalledRegion[]
  pending: PendingChanges
}

const EMPTY: StoredState = { regions: [], pending: { add: [], remove: [] } }

// Survives dev hot reloads; there is one admin process per data volume.
const globalForState = globalThis as typeof globalThis & { adminState?: StoredState }

export async function loadState(): Promise<StoredState> {
  if (globalForState.adminState) return globalForState.adminState
  let state: StoredState
  try {
    state = { ...EMPTY, ...JSON.parse(await readFile(paths.state, 'utf8')) }
  } catch {
    state = await adoptExistingExtracts()
    await persist(state)
  }
  globalForState.adminState = state
  return state
}

export async function saveState(state: StoredState) {
  globalForState.adminState = state
  await persist(state)
}

async function persist(state: StoredState) {
  await mkdir(paths.admin, { recursive: true })
  await writeFile(`${paths.state}.tmp`, JSON.stringify(state, null, 2))
  await rename(`${paths.state}.tmp`, paths.state)
}

// Tiles built before the admin existed came from Geofabrik extracts dropped in the data folder
// (e.g. new-york-latest.osm.pbf). Match them to catalog regions and move them into the regions folder.
async function adoptExistingExtracts(): Promise<StoredState> {
  const state: StoredState = structuredClone(EMPTY)
  const files = (await readdir(DATA_DIR).catch(() => [])).filter((file) => file.endsWith('.osm.pbf'))
  if (!files.length) return state
  const { regions } = await getCatalog()
  await mkdir(paths.regions, { recursive: true })
  for (const file of files) {
    const matches = regions.filter((region) => path.basename(new URL(region.pbfUrl).pathname) === file)
    // Ambiguous names (georgia-latest is both the country and the US state) are left alone.
    if (matches.length !== 1) continue
    const region = matches[0]
    const target = path.join(paths.regions, fileNameFor(region.id))
    await rename(path.join(DATA_DIR, file), target)
    const info = await stat(target)
    state.regions.push({ id: region.id, name: region.name, pbfUrl: region.pbfUrl, file: fileNameFor(region.id), bytes: info.size, downloadedAt: info.mtime.toISOString() })
  }
  return state
}

export class PendingChangeError extends Error {}

// Stages a region to be added on the next build. Adding a region that contains installed or pending ones
// replaces them, since Geofabrik extracts of a parent already include all of its children.
export async function stageAdd(id: string) {
  const state = await loadState()
  const { byId } = await getCatalog()
  const region = byId.get(id)
  if (!region) throw new PendingChangeError(`There is no region called ${id}.`)

  if (state.pending.remove.includes(id)) {
    state.pending.remove = state.pending.remove.filter((other) => other !== id)
    await saveState(state)
    return
  }
  if (state.regions.some((installed) => installed.id === id) || state.pending.add.some((added) => added.id === id)) return

  const ancestors = ancestorsOf(id, byId)
  const coveredBy = ancestors.find((ancestor) => isSelected(state, ancestor.id))
  if (coveredBy) throw new PendingChangeError(`${region.name} is already part of ${coveredBy.name}.`)

  const isInside = (other: string) => ancestorsOf(other, byId).some((ancestor) => ancestor.id === id)
  state.pending.add = state.pending.add.filter((added) => !isInside(added.id))
  for (const installed of state.regions) {
    if (isInside(installed.id) && !state.pending.remove.includes(installed.id)) state.pending.remove.push(installed.id)
  }
  state.pending.add.push({ id, name: region.name, bytes: await fetchSize(region) })
  await saveState(state)
}

export async function stageRemove(id: string) {
  const state = await loadState()
  if (state.pending.add.some((added) => added.id === id)) {
    state.pending.add = state.pending.add.filter((added) => added.id !== id)
  } else if (state.regions.some((installed) => installed.id === id) && !state.pending.remove.includes(id)) {
    state.pending.remove.push(id)
  }
  await saveState(state)
}

export async function clearPending() {
  const state = await loadState()
  state.pending = { add: [], remove: [] }
  await saveState(state)
}

function isSelected(state: StoredState, id: string) {
  const installed = state.regions.some((region) => region.id === id) && !state.pending.remove.includes(id)
  return installed || state.pending.add.some((added) => added.id === id)
}

async function fetchSize(region: CatalogRegion): Promise<number | null> {
  try {
    // Geofabrik redirects to a dated file first, which can be slow.
    const response = await fetch(region.pbfUrl, { method: 'HEAD', signal: AbortSignal.timeout(20_000) })
    const length = Number(response.headers.get('content-length'))
    return response.ok && length > 0 ? length : null
  } catch {
    return null
  }
}

export function regionFile(region: Pick<InstalledRegion, 'file'>) {
  return path.join(paths.regions, region.file)
}

export function hasServingTiles() {
  return existsSync(paths.servingTiles)
}
