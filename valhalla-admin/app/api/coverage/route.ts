import { connection } from 'next/server'
import { coverageAt } from '@/lib/server/coverage'

// GET /api/coverage?lat=52.37&lng=4.89 -> Coverage (lib/types.ts). For routing clients to ask whether Valhalla can
// route from a point before trying, and which region to install when it cannot.
export async function GET(request: Request) {
  await connection()
  const params = new URL(request.url).searchParams
  const lat = Number(params.get('lat'))
  const lng = Number(params.get('lng'))
  if (!params.get('lat') || !params.get('lng') || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: 'Pass lat and lng as numbers, e.g. ?lat=52.37&lng=4.89.' }, { status: 400 })
  }
  try {
    return Response.json(await coverageAt(lat, lng))
  } catch (error) {
    console.error('Coverage lookup failed', error)
    return Response.json({ error: 'Region outlines could not be loaded from Geofabrik.' }, { status: 502 })
  }
}
