import { connection } from 'next/server'
import { getAdminState } from '@/lib/server/status'

export async function GET() {
  await connection()
  return Response.json(await getAdminState())
}
