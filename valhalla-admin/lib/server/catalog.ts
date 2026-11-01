import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { CatalogRegion } from '@/lib/types'
import { paths } from './config'

const INDEX_URL = 'https://download.geofabrik.de/index-v1-nogeom.json'
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

// Not in Geofabrik's index; it contains every other region.
export const PLANET: CatalogRegion = {
  id: 'planet',
  name: 'Planet',
  parent: null,
  pbfUrl: 'https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf',
}

type GeofabrikIndex = { features: { properties: { id: string; name: string; parent?: string; urls: { pbf: string } } }[] }

let memory: { regions: CatalogRegion[]; byId: Map<string, CatalogRegion> } | null = null

export async function getCatalog() {
  if (memory) return memory
  const regions = normalize(await loadIndex())
  memory = { regions, byId: new Map(regions.map((region) => [region.id, region])) }
  return memory
}

async function loadIndex(): Promise<GeofabrikIndex> {
  const cached = await readCache()
  if (cached && cached.fresh) return cached.index
  try {
    const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Geofabrik answered ${response.status}`)
    const text = await response.text()
    const index = JSON.parse(text) as GeofabrikIndex
    await mkdir(paths.admin, { recursive: true })
    await writeFile(`${paths.catalogCache}.tmp`, text)
    await rename(`${paths.catalogCache}.tmp`, paths.catalogCache)
    return index
  } catch (error) {
    // An old list beats no list when Geofabrik is unreachable.
    if (cached) return cached.index
    throw error
  }
}

async function readCache() {
  try {
    const [text, info] = await Promise.all([readFile(paths.catalogCache, 'utf8'), stat(paths.catalogCache)])
    return { index: JSON.parse(text) as GeofabrikIndex, fresh: Date.now() - info.mtimeMs < CACHE_MAX_AGE_MS }
  } catch {
    return null
  }
}

// Geofabrik lists US states as children of north-america with their id as the name ("us/new-york");
// derive the parent and a readable name from the id instead.
function normalize(index: GeofabrikIndex): CatalogRegion[] {
  const regions = index.features.map(({ properties }) => {
    const slash = properties.id.lastIndexOf('/')
    const parent = slash > 0 ? properties.id.slice(0, slash) : properties.parent ?? null
    // Only when the name is the id: real names contain slashes too, e.g. "Congo (Republic/Brazzaville)".
    const name = properties.name === properties.id && slash > 0 ? titleCase(properties.id.slice(slash + 1)) : properties.name
    return { id: properties.id, name, parent: parent ?? PLANET.id, pbfUrl: properties.urls.pbf }
  })
  return [PLANET, ...regions.sort((a, b) => a.name.localeCompare(b.name))]
}

function titleCase(slug: string) {
  return slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

// The chain of regions containing this one, nearest first.
export function ancestorsOf(id: string, byId: Map<string, CatalogRegion>): CatalogRegion[] {
  const chain: CatalogRegion[] = []
  let current = byId.get(id)?.parent
  while (current) {
    const region = byId.get(current)
    if (!region) break
    chain.push(region)
    current = region.parent
  }
  return chain
}

// Safe as a file name and unique: "us/georgia" and "georgia" (the country) would otherwise collide.
export function fileNameFor(id: string) {
  return `${id.replace(/\//g, '__')}.osm.pbf`
}
