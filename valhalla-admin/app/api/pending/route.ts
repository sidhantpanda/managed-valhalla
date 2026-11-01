import { clearPending, PendingChangeError, stageAdd, stageRemove } from '@/lib/server/state'
import { getAdminState } from '@/lib/server/status'

// Stages a region change for the next build: { action: "add" | "remove", id } or { action: "clear" }.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: string; id?: unknown } | null
  try {
    if (body?.action === 'clear') await clearPending()
    else if ((body?.action === 'add' || body?.action === 'remove') && typeof body.id === 'string') {
      await (body.action === 'add' ? stageAdd(body.id) : stageRemove(body.id))
    } else {
      return Response.json({ error: 'Send { action: "add" | "remove", id } or { action: "clear" }.' }, { status: 400 })
    }
  } catch (error) {
    if (error instanceof PendingChangeError) return Response.json({ error: error.message }, { status: 409 })
    throw error
  }
  return Response.json(await getAdminState())
}
