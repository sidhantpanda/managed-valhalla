import { connection } from 'next/server'
import { getCatalog } from '@/lib/server/catalog'

export async function GET() {
  await connection()
  try {
    const { regions } = await getCatalog()
    return Response.json({ regions })
  } catch (error) {
    console.error('Loading the region list failed', error)
    return Response.json({ error: 'The region list could not be loaded from Geofabrik. Check the internet connection and reload.' }, { status: 502 })
  }
}
