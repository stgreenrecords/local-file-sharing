/**
 * Transfer & sync queue: live stream, pending, completed, and a throughput
 * waveform. Every figure is measured — nothing here is decorative.
 */
import { useMemo, type ReactNode } from 'react'
import type { TransferJob } from '@shared/types'
import {
  formatBytes,
  formatDuration,
  formatEta,
  formatRate,
  percent,
  splitBytes
} from '@shared/format'
import { useTransfers, partitionJobs, type RateSample } from '../state/useTransfers'
import { useNodes } from '../state/useNodes'
import { useSettings, effective } from '../state/useSettings'
import { STATUS_LABEL, STATUS_TEXT, iconForEntry } from '../lib/tone'
import { Button, Radio } from '../components/controls'
import {
  EmptyState,
  Icon,
  Pill,
  ProgressBar,
  SectionCard,
  StatTile,
  StatusDot
} from '../components/primitives'
import type { ConflictPolicy } from '@shared/types'

export function Queue(): ReactNode {
  const { snapshot, samples, pause, resume, cancelBatch, clearDone } = useTransfers()
  const { active, pending, completed, failed } = partitionJobs(snapshot)
  const nodeName = useNodes((s) => s.nodeName)

  const remaining = Math.max(0, snapshot.bytesTotal - snapshot.bytesDone)
  const done = percent(snapshot.bytesDone, snapshot.bytesTotal)
  const currentBatch = snapshot.batches[0]
  const throughput = splitBytes(snapshot.bps)
  const peak = useMemo(() => samples.reduce((max, s) => Math.max(max, s.bps), 0), [samples])

  const idle = snapshot.jobs.length === 0

  if (idle) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-space-xl">
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/30 max-w-2xl w-full">
          <EmptyState
            icon="sync_alt"
            title="No transfers yet"
            detail="Select files in one pane, then press F5 to copy them into the other pane. Progress, throughput and checksum verification all show up here."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto omni-scroll p-space-lg space-y-space-lg">
      {/* Metric tiles */}
      <div className="flex flex-wrap gap-space-base">
        <StatTile
          label="Throughput"
          value={throughput.value}
          unit={`${throughput.unit}/s`}
          aside={
            <span className="flex items-center gap-space-2xs font-data-tabular-sm text-data-tabular-sm text-secondary">
              <StatusDot tone={snapshot.bps > 0 ? 'secondary' : 'neutral'} pulse={snapshot.bps > 0} />
              {snapshot.paused ? 'paused' : snapshot.bps > 0 ? 'streaming' : 'idle'}
            </span>
          }
          footer={
            <>
              <span>
                {currentBatch === undefined
                  ? 'no batch'
                  : `${nodeName(currentBatch.sourceNode.id)} → ${nodeName(currentBatch.targetNode.id)}`}
              </span>
              <span className="text-secondary">peak {formatRate(peak)}</span>
            </>
          }
        />
        <StatTile
          label="Payload volume"
          value={splitBytes(snapshot.bytesDone).value}
          unit={`${splitBytes(snapshot.bytesDone).unit} / ${formatBytes(snapshot.bytesTotal)}`}
          tone="neutral"
          aside={
            <span className="font-data-tabular-sm text-data-tabular-sm text-primary">
              {done.toFixed(1)}% done
            </span>
          }
          footer={
            <>
              <span>Files remaining: {pending.length + active.length}</span>
              <span>Total: {snapshot.jobs.length}</span>
            </>
          }
        />
        <StatTile
          label="Estimated time"
          value={formatEta(remaining, snapshot.bps > 0 ? snapshot.bps : null)}
          tone="secondary"
          aside={<Icon name="timer" size={14} className="text-on-surface-variant" />}
          footer={
            <>
              <span>{formatBytes(remaining)} remaining</span>
              <span className={failed.length > 0 ? 'text-danger' : 'text-secondary'}>
                {failed.length > 0 ? `${failed.length} failed` : 'no errors'}
              </span>
            </>
          }
        />
        <StatTile
          label="Verification"
          value={completed.filter((j) => j.sha256 !== undefined).length.toString()}
          unit="hashed"
          tone="tertiary"
          aside={<Icon name="verified" size={14} className="text-tertiary" />}
          footer={
            <>
              <span>SHA-256 end to end</span>
              <span>{completed.length} completed</span>
            </>
          }
        />
      </div>

      {/* Batch controls */}
      <div className="bg-surface-container-low rounded-lg border border-outline-variant/30 p-space-lg">
        <div className="flex items-center justify-between gap-space-base flex-wrap mb-space-base">
          <div className="flex items-center gap-space-sm">
            {snapshot.paused ? (
              <Button icon="play_arrow" variant="accent" onClick={() => void resume()}>
                Resume
              </Button>
            ) : (
              <Button icon="pause" variant="accent" onClick={() => void pause()}>
                Pause all
              </Button>
            )}
            {currentBatch !== undefined && (
              <Button
                icon="stop_circle"
                variant="danger"
                onClick={() => void cancelBatch(currentBatch.id)}
              >
                Cancel batch
              </Button>
            )}
            <Button icon="clear_all" onClick={() => void clearDone()}>
              Clear finished
            </Button>
          </div>
          <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant">
            {currentBatch?.scanning === true
              ? 'Measuring folder contents…'
              : `${snapshot.batches.length} ${snapshot.batches.length === 1 ? 'batch' : 'batches'}`}
          </span>
        </div>
        <ProgressBar value={done} height={6} />
        <div className="flex items-center justify-between mt-space-sm font-data-tabular-md text-data-tabular-md">
          <span className="text-on-surface">{done.toFixed(1)}% completed</span>
          <span className="text-on-surface-variant">
            {formatBytes(remaining)} remaining on the session queue
          </span>
        </div>
      </div>

      {/* Active stream */}
      {active.length > 0 && (
        <div className="bg-surface-container-low rounded-lg border border-outline-variant/30 p-space-lg">
          <div className="flex items-center justify-between gap-space-base mb-space-lg">
            <h2 className="flex items-center gap-space-sm font-headline-lg text-headline-lg text-on-surface">
              <StatusDot tone="secondary" pulse />
              Currently active stream
            </h2>
            <span className="flex items-center gap-space-base font-data-tabular-md text-data-tabular-md text-on-surface-variant">
              <span className="flex items-center gap-space-2xs text-secondary">
                <Icon name="verified_user" size={14} />
                SHA-256 verified on close
              </span>
            </span>
          </div>
          {active.map((job) => (
            <ActiveJob key={job.id} job={job} />
          ))}
        </div>
      )}

      {/* Pending / completed */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-space-base">
        <JobList
          title="Pending queue"
          icon="pending_actions"
          count={pending.length}
          totalLabel={`${formatBytes(pending.reduce((s, j) => s + j.totalBytes, 0))} staged`}
          jobs={pending}
          emptyLabel="Nothing waiting."
        />
        <JobList
          title="Completed"
          icon="task_alt"
          count={completed.length}
          totalLabel={`${formatBytes(completed.reduce((s, j) => s + j.transferredBytes, 0))} synced`}
          jobs={completed}
          emptyLabel="Nothing finished yet."
        />
      </div>

      {failed.length > 0 && (
        <JobList
          title="Failed and cancelled"
          icon="error"
          count={failed.length}
          totalLabel="needs attention"
          jobs={failed}
          emptyLabel=""
        />
      )}

      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-space-base">
        <ThroughputChart samples={samples} peak={peak} />
        <ConflictPolicyCard />
      </div>
    </div>
  )
}

function ActiveJob({ job }: { job: TransferJob }): ReactNode {
  const nodeName = useNodes((s) => s.nodeName)
  const progress = percent(job.transferredBytes, job.totalBytes)
  const remaining = job.totalBytes - job.transferredBytes

  return (
    <div className="space-y-space-base">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-base">
        <PathBlock
          label={`Source · ${nodeName(job.source.nodeId)}`}
          icon="upload_file"
          path={job.source.path}
        />
        <PathBlock
          label={`Target · ${nodeName(job.target.nodeId)}`}
          icon="save"
          path={job.target.path}
        />
      </div>

      <div className="omni-inset rounded p-space-base">
        <div className="flex items-center justify-between gap-space-base mb-space-sm flex-wrap">
          <span className="flex items-center gap-space-sm min-w-0">
            <Icon name="draft" size={14} className="text-primary" />
            <span className="font-body-lg text-body-lg text-on-surface truncate">
              {job.relativePath}
            </span>
            <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant shrink-0">
              {formatBytes(job.transferredBytes)} / {formatBytes(job.totalBytes)} (
              {progress.toFixed(0)}%)
            </span>
          </span>
          <span className="flex items-center gap-space-base font-data-tabular-md text-data-tabular-md shrink-0">
            {job.status === 'awaiting-decision' ? (
              <span className="text-warning">waiting for your decision</span>
            ) : (
              <>
                <span className="text-secondary">{formatRate(job.bps)}</span>
                <span className="text-outline">|</span>
                <span className="text-on-surface-variant">
                  ETA {formatEta(remaining, job.bps)}
                </span>
              </>
            )}
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>
    </div>
  )
}

function PathBlock({
  label,
  icon,
  path
}: {
  label: string
  icon: string
  path: string
}): ReactNode {
  return (
    <div>
      <p className="flex items-center gap-space-xs font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant mb-space-xs">
        <Icon name={icon} size={13} className="text-primary" />
        {label}
      </p>
      <p className="omni-inset rounded px-space-base py-space-sm font-data-tabular-md text-data-tabular-md text-on-surface break-all select-text">
        {path}
      </p>
    </div>
  )
}

function JobList({
  title,
  icon,
  count,
  totalLabel,
  jobs,
  emptyLabel
}: {
  title: string
  icon: string
  count: number
  totalLabel: string
  jobs: TransferJob[]
  emptyLabel: string
}): ReactNode {
  return (
    <section className="bg-surface-container-low rounded-lg border border-outline-variant/30 p-space-lg">
      <header className="flex items-center justify-between gap-space-base mb-space-base">
        <h2 className="flex items-center gap-space-sm font-headline-lg text-headline-lg text-on-surface">
          <Icon name={icon} size={17} className="text-primary" />
          {title}
          <Pill tone="neutral">{count}</Pill>
        </h2>
        <span className="font-data-tabular-md text-data-tabular-md text-secondary">
          {totalLabel}
        </span>
      </header>

      {jobs.length === 0 ? (
        <p className="font-body-md text-body-md text-outline">{emptyLabel}</p>
      ) : (
        <ul className="space-y-space-2xs max-h-[340px] overflow-y-auto omni-scroll">
          {jobs.slice(0, 200).map((job) => (
            <li
              key={job.id}
              className="flex items-center gap-space-base omni-inset rounded px-space-base py-space-sm"
            >
              <Icon
                name={iconForEntry(job.relativePath, extOf(job.relativePath), false)}
                size={15}
                className="text-on-surface-variant shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="block font-body-md text-body-md text-on-surface truncate">
                  {job.relativePath}
                </span>
                <span
                  className={`block font-data-tabular-sm text-data-tabular-sm truncate ${STATUS_TEXT[job.status]}`}
                >
                  {job.error ?? statusDetail(job)}
                </span>
              </span>
              <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant shrink-0">
                {formatBytes(job.totalBytes)}
              </span>
              <span className={`shrink-0 ${STATUS_TEXT[job.status]}`}>
                <Pill tone={job.status === 'done' ? 'secondary' : job.status === 'failed' ? 'danger' : 'neutral'}>
                  {STATUS_LABEL[job.status]}
                </Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function statusDetail(job: TransferJob): string {
  if (job.status === 'done') {
    const seconds =
      job.startedAt !== undefined && job.finishedAt !== undefined
        ? (job.finishedAt - job.startedAt) / 1000
        : null
    const rate = seconds !== null && seconds > 0 ? formatRate(job.totalBytes / seconds) : '--'
    const checksum = job.sha256 === undefined ? 'not verified' : `sha256 ${job.sha256.slice(0, 8)}`
    return `${rate} sustained · ${checksum}${seconds === null ? '' : ` · ${formatDuration(seconds)}`}`
  }
  if (job.status === 'skipped') return 'skipped by the conflict policy'
  return job.target.path
}

/** Local extension helper — the queue only has a relative path, not a DirEntry. */
function extOf(relativePath: string): string {
  const name = relativePath.slice(relativePath.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

function ThroughputChart({ samples, peak }: { samples: RateSample[]; peak: number }): ReactNode {
  const width = 640
  const height = 160
  const ceiling = Math.max(peak, 1)

  const points = samples.map((sample, index) => {
    const x = samples.length <= 1 ? 0 : (index / (samples.length - 1)) * width
    const y = height - (sample.bps / ceiling) * (height - 12)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const area =
    points.length > 1 ? `0,${height} ${points.join(' ')} ${width},${height}` : ''

  return (
    <section className="bg-surface-container-low rounded-lg border border-outline-variant/30 p-space-lg">
      <header className="flex items-center justify-between gap-space-base mb-space-base">
        <h2 className="flex items-center gap-space-sm font-headline-lg text-headline-lg text-on-surface">
          <Icon name="ssid_chart" size={17} className="text-primary" />
          Throughput
        </h2>
        <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
          peak <span className="text-secondary">{formatRate(peak)}</span> · one sample per second
        </span>
      </header>

      <div className="omni-inset rounded p-space-base">
        {samples.length < 2 ? (
          <p className="font-body-md text-body-md text-outline py-space-xl text-center">
            Collecting samples…
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[160px]"
            preserveAspectRatio="none"
            role="img"
            aria-label={`Throughput over the last ${samples.length} seconds, peaking at ${formatRate(peak)}`}
          >
            <defs>
              <linearGradient id="tx-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2={width}
                y1={height * fraction}
                y2={height * fraction}
                stroke="#3e484f"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
            ))}
            <polygon points={area} fill="url(#tx-fill)" />
            <polyline
              points={points.join(' ')}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </section>
  )
}

const POLICIES: Array<{ value: ConflictPolicy; label: string; detail: string; aside: string }> = [
  {
    value: 'ask',
    label: 'Ask each time',
    detail: 'Pauses the queue and shows both files side by side so you can choose.',
    aside: 'Default'
  },
  {
    value: 'overwrite-if-newer',
    label: 'Overwrite if the source is newer',
    detail: 'Compares modification times and skips anything the target already has fresher.',
    aside: 'mtime delta'
  },
  {
    value: 'keep-both',
    label: 'Keep both',
    detail: 'Writes the incoming file as "name (2).ext" and leaves the original untouched.',
    aside: 'Safe'
  },
  {
    value: 'skip-identical',
    label: 'Skip identical',
    detail: 'Treats same-size, same-mtime files as already synced and moves on.',
    aside: 'Fast resync'
  }
]

function ConflictPolicyCard(): ReactNode {
  const settingsState = useSettings()
  const policy = effective(settingsState, 'conflictPolicy', 'ask')

  return (
    <SectionCard
      icon="rule_settings"
      title="Collision policy"
      subtitle="What to do when the target already holds a file at the same path."
    >
      <div className="space-y-space-sm">
        {POLICIES.map((option) => (
          <Radio
            key={option.value}
            checked={policy === option.value}
            label={option.label}
            detail={option.detail}
            aside={
              <span className="font-data-tabular-sm text-data-tabular-sm text-on-surface-variant">
                {option.aside}
              </span>
            }
            onChange={() => {
              settingsState.edit({ conflictPolicy: option.value })
              void settingsState.save()
            }}
          />
        ))}
      </div>
    </SectionCard>
  )
}
