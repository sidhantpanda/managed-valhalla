import { BuildError, cancelBuild, startBuild } from '@/lib/server/build'
import { getAdminState } from '@/lib/server/status'

// Applies the pending changes: downloads new regions and rebuilds Valhalla's tiles. { refresh: true } re-downloads every region.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { refresh?: boolean }
  try {
    await startBuild({ refresh: body.refresh === true })
  } catch (error) {
    if (error instanceof BuildError) return Response.json({ error: error.message }, { status: 409 })
    throw error
  }
  return Response.json(await getAdminState(), { status: 202 })
}

// Cancels the running build. Valhalla keeps serving the previous tiles.
export async function DELETE() {
  try {
    cancelBuild()
  } catch (error) {
    if (error instanceof BuildError) return Response.json({ error: error.message }, { status: 409 })
    throw error
  }
  return Response.json(await getAdminState())
}
