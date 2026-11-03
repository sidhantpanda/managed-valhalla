import { startBuild } from './build'
import { DEFAULT_REGIONS } from './config'
import { warmCoverage } from './coverage'
import { hasServingTiles, loadState, stageAdd } from './state'

// Runs once when the server starts: adopts extracts from before the admin existed, and on a fresh
// data volume installs DEFAULT_REGIONS so Valhalla has something to serve without a visit to the UI.
export async function boot() {
  void warmCoverage()
  try {
    const state = await loadState()
    if (state.regions.length || hasServingTiles() || !DEFAULT_REGIONS.length) return
    for (const id of DEFAULT_REGIONS) await stageAdd(id)
    await startBuild()
    console.log(`Installing default regions: ${DEFAULT_REGIONS.join(', ')}`)
  } catch (error) {
    console.error('Startup failed', error)
  }
}
