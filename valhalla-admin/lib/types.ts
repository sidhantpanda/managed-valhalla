// Shapes shared by the API routes and the browser.

export type CatalogRegion = {
  id: string
  name: string
  parent: string | null
  pbfUrl: string
}

export type CoverageRegion = { id: string; name: string }

// GET /api/coverage?lat=&lng=: whether Valhalla can route from a point, and which regions it lies in.
export type Coverage = {
  // The served tiles include this point.
  covered: boolean
  // The installed region that covers it ("planet" when the planet is installed), or null.
  servedBy: CoverageRegion | null
  // The smallest Geofabrik region containing the point: the one to install to cover it. Null at sea.
  region: CoverageRegion | null
  // The country (one level below a continent) that region belongs to, or null.
  country: CoverageRegion | null
}

export type InstalledRegion = {
  id: string
  name: string
  pbfUrl: string
  // File name inside the regions folder of the data volume.
  file: string
  bytes: number
  downloadedAt: string
}

export type PendingChanges = {
  add: { id: string; name: string; bytes: number | null }[]
  remove: string[]
}

export type StepId = 'download' | 'merge' | 'timezones' | 'admins' | 'parse' | 'graph' | 'elevation' | 'enhance' | 'publish'

export type StepStatus = 'waiting' | 'running' | 'done' | 'skipped' | 'failed'

export type JobStep = { id: StepId; label: string; status: StepStatus; progress: number }

export type JobDownload = { id: string; name: string; received: number; total: number | null; done: boolean }

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export type Job = {
  id: string
  status: JobStatus
  // What the build was asked to do, for the summary line.
  summary: string
  // Ids of every region the new tiles will cover.
  regionIds: string[]
  startedAt: string
  finishedAt: string | null
  progress: number
  steps: JobStep[]
  downloads: JobDownload[]
  error: string | null
  log: string[]
}

export type ValhallaStatus =
  | { online: true; version: string; tilesetBuiltAt: string | null }
  | { online: false; reason: string }

export type AdminState = {
  regions: InstalledRegion[]
  pending: PendingChanges
  job: Job | null
  valhalla: ValhallaStatus
  disk: { freeBytes: number; totalBytes: number; regionBytes: number; tilesBytes: number }
  buildElevation: boolean
}
