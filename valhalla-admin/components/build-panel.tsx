'use client'

import { Check, CircleAlert, LoaderCircle, Minus, X } from 'lucide-react'
import type { Job, JobStep } from '@/lib/types'
import { formatAgo, formatBytes, formatDuration } from '@/lib/format'
import { ScaleBar } from './scale-bar'

type Props = {
  job: Job
  now: number
  onCancel: () => void
  busy: boolean
}

export function BuildPanel({ job, now, onCancel, busy }: Props) {
  const running = job.status === 'running'
  const current = job.steps.find((step) => step.status === 'running')
  const percent = Math.round(job.progress * 100)

  return (
    <section aria-labelledby="build-title" className="border-[1.5px] border-ink bg-sheet p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="build-title" className="text-lg font-semibold">
          {running ? 'Building routing tiles' : job.status === 'succeeded' ? 'Tiles rebuilt' : job.status === 'cancelled' ? 'Build cancelled' : 'Build failed'}
        </h2>
        <p className="text-sm text-ink-soft">
          {running ? `Running for ${formatDuration(job.startedAt, null, now)}` : `${formatAgo(job.finishedAt, now)}, took ${formatDuration(job.startedAt, job.finishedAt)}`}
        </p>
      </div>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">{job.summary}</p>

      {(running || job.status === 'failed' || job.status === 'cancelled') && (
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <span className="text-sm">{current ? current.label : running ? 'Starting' : 'Stopped'}</span>
            <span className="text-3xl font-semibold leading-none" style={{ fontStretch: '72%' }}>{percent}%</span>
          </div>
          <ScaleBar progress={job.progress} label="Build progress" />
        </div>
      )}

      {job.status === 'succeeded' && <p className="mt-4 text-sm">Valhalla restarted onto the new tiles and is routing with them now.</p>}
      {job.status === 'cancelled' && <p className="mt-2 text-sm">Valhalla keeps serving the previous tiles.</p>}
      {job.error && (
        <p className="mt-4 flex gap-2 border-l-[3px] border-road bg-road-tint px-3 py-2 text-sm">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-road" aria-hidden />
          <span>{job.error}. Valhalla keeps serving the previous tiles. The log below shows the last output.</span>
        </p>
      )}

      {/* Columns fill top to bottom so the numbered steps read in order. */}
      <ol className="mt-6 gap-x-8 text-sm sm:columns-2">
        {job.steps.filter((step) => step.status !== 'skipped').map((step, index) => (
          <StepRow key={step.id} step={step} number={index + 1} />
        ))}
      </ol>

      {job.downloads.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Downloads from Geofabrik</h3>
          <ul className="mt-2 space-y-2">
            {job.downloads.map((download) => {
              const share = download.total ? download.received / download.total : download.done ? 1 : 0
              return (
                <li key={download.id} className="text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="map-label font-medium">{download.name}</span>
                    <span className="text-ink-soft">
                      {download.done
                        ? formatBytes(download.received)
                        : download.total ? `${formatBytes(download.received)} of ${formatBytes(download.total)}` : download.received ? formatBytes(download.received) : 'Waiting'}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 bg-rule">
                    <div className="h-full bg-water transition-[width] duration-300" style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-ink-soft hover:text-ink">Build log</summary>
        <pre className="mt-2 max-h-72 overflow-auto bg-paper p-3 text-xs leading-relaxed text-ink-soft">{job.log.slice(-120).join('\n') || 'No output yet.'}</pre>
      </details>

      {running && (
        <button
          onClick={onCancel}
          disabled={busy}
          className="mt-6 inline-flex items-center gap-2 border-[1.5px] border-road px-4 py-2 text-sm font-semibold text-road hover:bg-road-tint disabled:opacity-50"
        >
          <X size={15} aria-hidden /> Cancel build
        </button>
      )}
    </section>
  )
}

function StepRow({ step, number }: { step: JobStep; number: number }) {
  const icon = {
    done: <Check size={15} className="text-water" aria-hidden />,
    running: <LoaderCircle size={15} className="animate-spin text-water" aria-hidden />,
    failed: <X size={15} className="text-road" aria-hidden />,
    waiting: <Minus size={15} className="text-contour" aria-hidden />,
    skipped: null,
  }[step.status]
  return (
    <li className={`flex break-inside-avoid items-center gap-3 py-1 ${step.status === 'waiting' ? 'text-ink-soft' : ''}`}>
      <span className="w-4 text-right text-xs text-contour">{number}</span>
      {icon}
      <span className={step.status === 'running' ? 'font-semibold' : ''}>{step.label}</span>
      {step.status === 'running' && step.progress > 0 && <span className="ml-auto text-ink-soft">{Math.round(step.progress * 100)}%</span>}
    </li>
  )
}
