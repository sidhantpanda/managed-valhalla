import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InstalledRegion, Job, JobStep, StepId } from '@/lib/types'
import { fileNameFor, getCatalog } from './catalog'
import { BUILD_ELEVATION, BUILD_THREADS, DEFAULT_SPEEDS_URL, paths } from './config'
import { loadState, regionFile, saveState } from './state'

// Seconds per step for a New York State build (500 MB extract, 4 threads), used to weigh progress.
const BUILD_WEIGHTS: Record<Exclude<StepId, 'download'>, number> = {
  merge: 8, timezones: 1, admins: 4, parse: 63, graph: 14, elevation: 10, enhance: 73, publish: 6,
}
// Downloading takes about as long as building per MB on a typical home connection.
const DOWNLOAD_WEIGHT_WHEN_EVERYTHING_IS_NEW = 150
const STEP_LABELS: Record<StepId, string> = {
  download: 'Download map data',
  merge: 'Combine regions',
  timezones: 'Prepare shared data',
  admins: 'Build country borders',
  parse: 'Read roads and paths',
  graph: 'Build the road graph',
  elevation: 'Add hills',
  enhance: 'Finish routing tiles',
  publish: 'Switch Valhalla to the new tiles',
}
// valhalla_build_tiles stages per step, with their relative run time (same measurement).
const TILE_STAGES: Partial<Record<StepId, [stage: string, weight: number][]>> = {
  parse: [['initialize', 3], ['parseways', 24], ['parserelations', 1], ['parseareaways', 0.1], ['parsenodes', 28], ['buildareas', 0.1], ['constructedges', 7]],
  graph: [['build', 1]],
  enhance: [['enhance', 14], ['filter', 0.1], ['transit', 0.1], ['bss', 0.1], ['hierarchy', 16], ['shortcuts', 6], ['restrictions', 17], ['elevation', 7], ['validate', 13], ['cleanup', 0.1]],
}
const LOG_LINES = 300

type Running = { job: Job; abort: AbortController; weights: Record<StepId, number> }

const globalForBuild = globalThis as typeof globalThis & { adminBuild?: Running; adminLastJob?: Job }

export function currentJob(): Job | null {
  return globalForBuild.adminBuild?.job ?? globalForBuild.adminLastJob ?? null
}

export class BuildError extends Error {}

export async function startBuild({ refresh = false } = {}): Promise<Job> {
  if (globalForBuild.adminBuild) throw new BuildError('A build is already running.')
  const state = await loadState()
  const { byId } = await getCatalog()

  const removed = new Set(state.pending.remove)
  const kept = state.regions.filter((region) => !removed.has(region.id))
  const added = state.pending.add.map(({ id }) => byId.get(id)).filter((region) => region !== undefined)
  const target: InstalledRegion[] = [
    ...kept,
    ...added.map((region) => ({ id: region.id, name: region.name, pbfUrl: region.pbfUrl, file: fileNameFor(region.id), bytes: 0, downloadedAt: '' })),
  ]
  if (!target.length) throw new BuildError('Add at least one region before building.')
  // Downloads land in a .part file and are renamed when complete, so an existing file is always a whole extract.
  const toDownload = target.filter((region) => refresh || !existsSync(regionFile(region)))

  const knownBytes = (region: InstalledRegion) => region.bytes || state.pending.add.find((added) => added.id === region.id)?.bytes || 0
  const totalBytes = target.reduce((sum, region) => sum + knownBytes(region), 0)
  const downloadBytes = toDownload.reduce((sum, region) => sum + knownBytes(region), 0)
  const weights: Record<StepId, number> = {
    download: totalBytes ? DOWNLOAD_WEIGHT_WHEN_EVERYTHING_IS_NEW * (downloadBytes / totalBytes) : DOWNLOAD_WEIGHT_WHEN_EVERYTHING_IS_NEW,
    ...BUILD_WEIGHTS,
  }

  const steps: JobStep[] = (Object.keys(weights) as StepId[]).map((id) => ({ id, label: STEP_LABELS[id], status: 'waiting', progress: 0 }))
  const skip = (id: StepId) => { steps.find((step) => step.id === id)!.status = 'skipped' }
  if (!toDownload.length) skip('download')
  if (target.length === 1) skip('merge')
  if (!BUILD_ELEVATION) skip('elevation')

  const job: Job = {
    id: Date.now().toString(36),
    status: 'running',
    summary: describe(added.map((region) => region.name), state.regions.filter((region) => removed.has(region.id)).map((region) => region.name), refresh),
    regionIds: target.map((region) => region.id),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: 0,
    steps,
    downloads: toDownload.map((region) => ({ id: region.id, name: region.name, received: 0, total: null, done: false })),
    error: null,
    log: [],
  }
  const running: Running = { job, abort: new AbortController(), weights }
  globalForBuild.adminBuild = running

  run(running, target, toDownload).catch(() => {})
  return job
}

export function cancelBuild() {
  const running = globalForBuild.adminBuild
  if (!running) throw new BuildError('No build is running.')
  running.abort.abort()
}

function describe(added: string[], removed: string[], refresh: boolean) {
  const parts = []
  if (added.length) parts.push(`Add ${added.join(', ')}`)
  if (removed.length) parts.push(`remove ${removed.join(', ')}`)
  if (refresh) parts.push(parts.length ? 'update map data' : 'Update map data')
  const text = parts.join('; ') || 'Rebuild routing tiles'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

async function run(running: Running, target: InstalledRegion[], toDownload: InstalledRegion[]) {
  const { job, abort, weights } = running
  const { signal } = abort
  const log = (line: string) => {
    job.log.push(line)
    if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES)
  }
  const step = (id: StepId) => job.steps.find((candidate) => candidate.id === id)!
  const setProgress = (id: StepId, progress: number) => {
    step(id).progress = Math.min(1, progress)
    const active = job.steps.filter((candidate) => candidate.status !== 'skipped')
    const total = active.reduce((sum, candidate) => sum + weights[candidate.id], 0)
    job.progress = active.reduce((sum, candidate) => sum + weights[candidate.id] * candidate.progress, 0) / total
  }
  const runStep = async (id: StepId, work: () => Promise<void>) => {
    if (step(id).status === 'skipped') return
    signal.throwIfAborted()
    step(id).status = 'running'
    log(`== ${STEP_LABELS[id]}`)
    await work()
    step(id).status = 'done'
    setProgress(id, 1)
  }
  const exec = (command: string, args: string[]) => runCommand(command, args, signal, log)

  const buildConfig = path.join(paths.build, 'valhalla.json')
  const buildTiles = path.join(paths.build, 'tiles')
  const buildTar = path.join(paths.build, 'valhalla_tiles.tar')
  const buildAdmins = path.join(paths.build, 'admins.sqlite')
  const merged = path.join(paths.build, 'merged.osm.pbf')
  let input = regionFile(target[0])

  try {
    await rm(paths.build, { recursive: true, force: true })
    await mkdir(paths.build, { recursive: true })
    await mkdir(paths.regions, { recursive: true })

    await runStep('download', async () => {
      for (const region of toDownload) {
        const download = job.downloads.find((candidate) => candidate.id === region.id)!
        await downloadFile(region.pbfUrl, regionFile(region), signal, (received, total) => {
          download.received = received
          download.total = total
          const known = job.downloads.reduce((sum, candidate) => sum + (candidate.total ?? 0), 0)
          const got = job.downloads.reduce((sum, candidate) => sum + candidate.received, 0)
          setProgress('download', known ? got / known : 0)
        })
        download.done = true
        const info = await stat(regionFile(region))
        region.bytes = info.size
        region.downloadedAt = new Date().toISOString()
        log(`Downloaded ${region.name} (${(info.size / 1e6).toFixed(0)} MB)`)
      }
    })

    // Regions whose extract was already on disk (e.g. from an earlier, failed build) still need their size recorded.
    for (const region of target) {
      if (region.bytes && region.downloadedAt) continue
      const info = await stat(regionFile(region))
      region.bytes = info.size
      region.downloadedAt ||= info.mtime.toISOString()
    }

    await runStep('merge', async () => {
      // Neighbouring Geofabrik extracts overlap at their borders; osmium drops the duplicate objects.
      await exec('osmium', ['merge', ...target.map(regionFile), '-o', merged, '--overwrite'])
      input = merged
    })

    await runStep('timezones', async () => {
      if (!existsSync(paths.defaultSpeeds)) await downloadFile(DEFAULT_SPEEDS_URL, paths.defaultSpeeds, signal, () => {})
      if (!existsSync(paths.timezones)) {
        // The tool writes the SQLite database to stdout.
        await exec('sh', ['-c', `valhalla_build_timezones > '${paths.timezones}.tmp'`])
        await rename(`${paths.timezones}.tmp`, paths.timezones)
      }
      const generated = await exec('valhalla_build_config', [
        '--mjolnir-tile-dir', buildTiles,
        '--mjolnir-tile-extract', buildTar,
        '--mjolnir-admin', buildAdmins,
        '--mjolnir-timezone', paths.timezones,
        '--mjolnir-concurrency', String(BUILD_THREADS),
        '--additional-data-elevation', paths.elevation,
      ])
      const config = JSON.parse(generated.stdout)
      config.mjolnir.default_speeds_config = paths.defaultSpeeds
      await writeFile(buildConfig, JSON.stringify(config, null, 2))
    })

    await runStep('admins', async () => {
      await exec('valhalla_build_admins', ['-c', buildConfig, input])
    })

    const runTileStages = async (id: StepId) => {
      const stages = TILE_STAGES[id]!
      const total = stages.reduce((sum, [, weight]) => sum + weight, 0)
      let done = 0
      for (const [stage, weight] of stages) {
        await exec('valhalla_build_tiles', ['-c', buildConfig, '-s', stage, '-e', stage, '-j', String(BUILD_THREADS), input])
        done += weight
        setProgress(id, done / total)
      }
    }
    await runStep('parse', () => runTileStages('parse'))
    await runStep('graph', () => runTileStages('graph'))
    await runStep('elevation', async () => {
      // Downloads only the elevation tiles that the road graph covers, and keeps them for later builds.
      await mkdir(paths.elevation, { recursive: true })
      await exec('valhalla_build_elevation', ['--from-tiles', '--decompress', '-c', buildConfig, '-v'])
    })
    await runStep('enhance', () => runTileStages('enhance'))

    await runStep('publish', async () => {
      await exec('valhalla_build_extract', ['-c', buildConfig, '-v', '--overwrite'])
      setProgress('publish', 0.6)
      signal.throwIfAborted()
      const serving = JSON.parse(await readFile(buildConfig, 'utf8'))
      serving.mjolnir.tile_dir = paths.servingTileDir
      serving.mjolnir.tile_extract = paths.servingTiles
      serving.mjolnir.admin = paths.servingAdmins
      // Config first: replacing the tar is what makes Valhalla restart, and it reads the config when it does.
      await writeFile(`${paths.servingConfig}.tmp`, JSON.stringify(serving, null, 2))
      await rename(`${paths.servingConfig}.tmp`, paths.servingConfig)
      await rename(buildAdmins, paths.servingAdmins)
      await rename(buildTar, paths.servingTiles)
      log('Valhalla is restarting onto the new tiles')
      // Loose tiles from the old self-building setup; the tar replaces them.
      await rm(paths.servingTileDir, { recursive: true, force: true })
    })

    const state = await loadState()
    const removed = state.regions.filter((region) => !target.some((kept) => kept.id === region.id))
    for (const region of removed) await rm(regionFile(region), { force: true })
    state.regions = target
    // Keep changes staged while this build ran; drop only the ones it applied.
    state.pending = {
      add: state.pending.add.filter((added) => !target.some((region) => region.id === added.id)),
      remove: state.pending.remove.filter((id) => target.some((region) => region.id === id)),
    }
    await saveState(state)
    job.status = 'succeeded'
  } catch (error) {
    if (signal.aborted) {
      job.status = 'cancelled'
      log('Build cancelled; Valhalla keeps serving the previous tiles')
    } else {
      job.status = 'failed'
      job.error = error instanceof Error ? error.message : String(error)
      log(`Failed: ${job.error}`)
    }
    for (const candidate of job.steps) if (candidate.status === 'running') candidate.status = 'failed'
  } finally {
    await rm(paths.build, { recursive: true, force: true }).catch(() => {})
    job.finishedAt = new Date().toISOString()
    globalForBuild.adminLastJob = job
    globalForBuild.adminBuild = undefined
  }
}

async function downloadFile(url: string, target: string, signal: AbortSignal, onProgress: (received: number, total: number | null) => void) {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`Downloading ${url} failed: HTTP ${response.status}`)
  const total = Number(response.headers.get('content-length')) || null
  let received = 0
  let lastReport = 0
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      // Reporting every chunk would be thousands of updates per second.
      if (Date.now() - lastReport > 250) {
        lastReport = Date.now()
        onProgress(received, total)
      }
      callback(null, chunk)
    },
  })
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), counter, createWriteStream(partial), { signal })
  onProgress(received, total)
  await rename(partial, target)
}

function runCommand(command: string, args: string[], signal: AbortSignal, log: (line: string) => void) {
  return new Promise<{ stdout: string }>((resolve, reject) => {
    log(`$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, { signal, killSignal: 'SIGKILL' })
    let stdout = ''
    let pendingLine = ''
    const collect = (chunk: Buffer, keep: boolean) => {
      const text = chunk.toString()
      if (keep) stdout += text
      const lines = (pendingLine + text).split(/\r?\n|\r/)
      pendingLine = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) log(line.replace(/\u001b\[[0-9;]*m/g, ''))
    }
    child.stdout.on('data', (chunk: Buffer) => collect(chunk, true))
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, false))
    child.on('error', reject)
    child.on('close', (code, killedBy) => {
      if (code === 0) resolve({ stdout })
      // The kernel's OOM killer sends SIGKILL when the container hits its memory limit.
      else if (killedBy === 'SIGKILL' && !signal.aborted) reject(new BuildError(`${command} ran out of memory. Raise VALHALLA_ADMIN_MEM_LIMIT (or lower VALHALLA_BUILD_THREADS) and apply again`))
      else reject(new Error(killedBy ? `${command} was stopped by ${killedBy}` : `${command} exited with code ${code}`))
    })
  })
}
