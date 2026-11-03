import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { CatalogRegion, Coverage, CoverageRegion } from '@/lib/types'
import { ancestorsOf, getCatalog, PLANET } from './catalog'
import { paths } from './config'
import { hasServingTiles, loadState } from './state'

// Which Geofabrik regions contain a point, and whether the tiles Valhalla serves cover it. Lets a routing client ask
// "can Valhalla route from here?" before trying, and name the region to install when it cannot.
//
// The outlines come from Geofabrik's index with geometry (about 4 MB, 550 regions), cached in the data volume and
// refreshed daily like the region list. They are the same polygons the extracts are cut with.

const INDEX_URL = 'https://download.geofabrik.de/index-v1.json'
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type Ring = number[][]
type Outline = { id: string; bbox: [number, number, number, number]; polygons: Ring[][] }
type GeometryIndex = { features: { properties: { id: string }; geometry: { type: 'MultiPolygon'; coordinates: Ring[][] } | null }[] }

let outlines: Promise<Outline[]> | null = null

function loadOutlines() {
  outlines ??= loadIndex()
    .then((index) =>
      index.features.flatMap(({ properties, geometry }) => (geometry ? [{ id: properties.id, bbox: bboxOf(geometry.coordinates), polygons: geometry.coordinates }] : [])),
    )
    .catch((error) => {
      // Try again on the next request rather than caching the failure.
      outlines = null
      throw error
    })
  return outlines
}

async function loadIndex(): Promise<GeometryIndex> {
  const cached = await readCache()
  if (cached?.fresh) return cached.index
  try {
    const response = await fetch(INDEX_URL, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`Geofabrik answered ${response.status}`)
    const text = await response.text()
    const index = JSON.parse(text) as GeometryIndex
    await mkdir(paths.admin, { recursive: true })
    await writeFile(`${paths.outlineCache}.tmp`, text)
    await rename(`${paths.outlineCache}.tmp`, paths.outlineCache)
    return index
  } catch (error) {
    // Old outlines beat none when Geofabrik is unreachable; regions rarely change shape.
    if (cached) return cached.index
    throw error
  }
}

async function readCache() {
  try {
    const [text, info] = await Promise.all([readFile(paths.outlineCache, 'utf8'), stat(paths.outlineCache)])
    return { index: JSON.parse(text) as GeometryIndex, fresh: Date.now() - info.mtimeMs < CACHE_MAX_AGE_MS }
  } catch {
    return null
  }
}

// Loads the outlines ahead of the first question, so routing clients with short timeouts get an answer at once.
export async function warmCoverage() {
  try {
    await Promise.all([loadOutlines(), getCatalog()])
  } catch (error) {
    console.error('Loading region outlines failed; /api/coverage will retry', error)
  }
}

export async function coverageAt(lat: number, lng: number): Promise<Coverage> {
  const [all, { byId }, state] = await Promise.all([loadOutlines(), getCatalog(), loadState()])
  // Smallest first: the most ancestors, then the smallest box. Geofabrik also has overlapping groupings (Alps, DACH,
  // Britain and Ireland), which sit higher up and so rank after the country or state the point is in.
  const containing = all
    .filter((outline) => inBox(outline.bbox, lng, lat) && outline.polygons.some((polygon) => inPolygon(polygon, lng, lat)))
    .map((outline) => ({ outline, region: byId.get(outline.id) }))
    .filter((match): match is { outline: Outline; region: CatalogRegion } => Boolean(match.region))
    .sort((a, b) => ancestorsOf(b.region.id, byId).length - ancestorsOf(a.region.id, byId).length || area(a.outline.bbox) - area(b.outline.bbox))
    .map(({ region }) => region)

  const installed = new Set(state.regions.map((region) => region.id))
  const servedBy = installed.has(PLANET.id) ? PLANET : containing.find((region) => installed.has(region.id)) ?? null
  const smallest = containing[0] ?? null
  return {
    covered: Boolean(servedBy) && hasServingTiles(),
    servedBy: servedBy && brief(servedBy),
    region: smallest && brief(smallest),
    country: smallest && countryOf(smallest, byId),
  }
}

// The region one level below a continent: a country, or Geofabrik's equivalent (a US state's parent is "us").
function countryOf(region: CatalogRegion, byId: Map<string, CatalogRegion>): CoverageRegion | null {
  const chain = [region, ...ancestorsOf(region.id, byId)]
  const index = chain.findIndex((link) => link.parent && byId.get(link.parent)?.parent === PLANET.id)
  return index >= 0 ? brief(chain[index]) : null
}

const brief = ({ id, name }: CatalogRegion): CoverageRegion => ({ id, name })

function bboxOf(polygons: Ring[][]): Outline['bbox'] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const polygon of polygons) {
    for (const [x, y] of polygon[0]) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  return [minX, minY, maxX, maxY]
}

const inBox = ([minX, minY, maxX, maxY]: Outline['bbox'], x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY
const area = ([minX, minY, maxX, maxY]: Outline['bbox']) => (maxX - minX) * (maxY - minY)

// Inside the outer ring and outside every hole.
function inPolygon([outer, ...holes]: Ring[], x: number, y: number) {
  return inRing(outer, x, y) && !holes.some((hole) => inRing(hole, x, y))
}

// Even-odd ray casting.
function inRing(ring: Ring, x: number, y: number) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
