// Build progress drawn as a map scale bar: alternating blocks with ticks, filled with survey blue as work completes.
const BLOCKS = 10
const TICKS = [0, 25, 50, 75, 100]

export function ScaleBar({ progress, label }: { progress: number; label: string }) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100)
  return (
    <div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="relative h-4 overflow-hidden border-[1.5px] border-ink"
      >
        <div className="absolute inset-0 flex">
          {Array.from({ length: BLOCKS }, (_, index) => (
            <div key={index} className={`flex-1 ${index % 2 ? 'bg-sheet' : 'bg-rule'} ${index ? 'border-l border-ink/60' : ''}`} />
          ))}
        </div>
        {/* The same blocks in blue, revealed from the left. */}
        <div className="absolute inset-0 flex transition-[clip-path] duration-500 ease-out" style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}>
          {Array.from({ length: BLOCKS }, (_, index) => (
            <div
              key={index}
              className={`flex-1 ${index ? 'border-l border-ink/60' : ''}`}
              style={{ background: index % 2 ? 'var(--water)' : 'color-mix(in oklab, var(--water) 72%, var(--ink))' }}
            />
          ))}
        </div>
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-soft">
        {TICKS.map((tick) => (
          <span
            key={tick}
            className="absolute -translate-x-1/2 before:absolute before:-top-1 before:left-1/2 before:h-1 before:w-px before:bg-ink first:translate-x-0 first:before:left-0 last:-translate-x-full last:before:left-auto last:before:right-0"
            style={{ left: `${tick}%` }}
          >
            {tick}
          </span>
        ))}
      </div>
    </div>
  )
}
