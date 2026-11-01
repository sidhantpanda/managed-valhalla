import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { AdminState, ValhallaStatus } from '@/lib/types'
import { currentJob } from './build'
import { BUILD_ELEVATION, DATA_DIR, VALHALLA_URL, paths } from './config'
import { loadState } from './state'

export async function getAdminState(): Promise<AdminState> {
  const [state, valhalla, disk, tiles] = await Promise.all([
    loadState(),
    getValhallaStatus(),
    diskSpace(),
    stat(paths.servingTiles).catch(() => null),
  ])
  return {
    regions: state.regions,
    pending: state.pending,
    job: currentJob(),
    valhalla,
    disk: {
      freeBytes: disk?.free ?? 0,
      totalBytes: disk?.total ?? 0,
      regionBytes: state.regions.reduce((sum, region) => sum + region.bytes, 0),
      tilesBytes: tiles?.size ?? 0,
    },
    buildElevation: BUILD_ELEVATION,
  }
}

async function getValhallaStatus(): Promise<ValhallaStatus> {
  try {
    const response = await fetch(`${VALHALLA_URL}/status`, { signal: AbortSignal.timeout(2000), cache: 'no-store' })
    if (!response.ok) return { online: false, reason: `Valhalla answered ${response.status}` }
    const body = await response.json() as { version: string; tileset_last_modified?: number }
    return {
      online: true,
      version: body.version,
      tilesetBuiltAt: body.tileset_last_modified ? new Date(body.tileset_last_modified * 1000).toISOString() : null,
    }
  } catch {
    return { online: false, reason: `Valhalla is not answering at ${VALHALLA_URL}` }
  }
}

// fs.statfs multiplies block counts by f_bsize, but Linux counts them in f_frsize, which differs on some
// mounts (Docker Desktop's file sharing reports 256x the real size). df does the arithmetic correctly.
async function diskSpace() {
  try {
    const { stdout } = await promisify(execFile)('df', ['-B1', '--output=size,avail', DATA_DIR])
    const [total, free] = stdout.trim().split('\n').pop()!.trim().split(/\s+/).map(Number)
    return { total, free }
  } catch {
    return null
  }
}
