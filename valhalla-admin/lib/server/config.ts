import os from 'node:os'
import path from 'node:path'

// The data volume shared with the Valhalla container (mounted at /custom_files in both).
export const DATA_DIR = process.env.DATA_DIR || '/custom_files'
export const VALHALLA_URL = (process.env.VALHALLA_URL || 'http://valhalla:8002').replace(/\/+$/, '')
export const BUILD_THREADS = Number(process.env.BUILD_THREADS) || Math.max(1, Math.min(4, os.cpus().length))
export const BUILD_ELEVATION = (process.env.BUILD_ELEVATION ?? 'true').toLowerCase() !== 'false'
// Regions to install on first start when nothing is installed yet, e.g. "us/new-york europe/monaco".
export const DEFAULT_REGIONS = (process.env.DEFAULT_REGIONS || '').split(/[\s,]+/).filter(Boolean)

export const paths = {
  regions: path.join(DATA_DIR, 'regions'),
  admin: path.join(DATA_DIR, 'admin'),
  state: path.join(DATA_DIR, 'admin', 'state.json'),
  catalogCache: path.join(DATA_DIR, 'admin', 'geofabrik-index.json'),
  // Region outlines, for /api/coverage.
  outlineCache: path.join(DATA_DIR, 'admin', 'geofabrik-outlines.json'),
  build: path.join(DATA_DIR, 'admin', 'build'),
  // What Valhalla serves. Replacing the tar makes the Valhalla container restart onto the new tiles.
  servingConfig: path.join(DATA_DIR, 'valhalla.json'),
  servingTiles: path.join(DATA_DIR, 'valhalla_tiles.tar'),
  servingTileDir: path.join(DATA_DIR, 'valhalla_tiles'),
  servingAdmins: path.join(DATA_DIR, 'admins.sqlite'),
  timezones: path.join(DATA_DIR, 'timezones.sqlite'),
  elevation: path.join(DATA_DIR, 'elevation_data'),
  defaultSpeeds: path.join(DATA_DIR, 'default_speeds.json'),
}

export const DEFAULT_SPEEDS_URL = 'https://raw.githubusercontent.com/OpenStreetMapSpeeds/schema/master/default_speeds.json'
