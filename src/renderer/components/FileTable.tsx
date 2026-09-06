/**
 * The dense file listing. Row heights are locked to the density tokens so the
 * visible item count is deterministic, and every numeric column is tabular.
 */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import type { DirEntry, NodePlatform, RowDensity, SortColumn } from '@shared/types'
import { formatBytes, formatMtime } from '@shared/format'
import { middleEllipsis } from '@shared/paths'
import { PARENT_ROW } from '../state/usePanes'
import { extTone, iconForEntry } from '../lib/tone'
import { Icon } from './primitives'

export interface FileTableProps {
  rows: Array<DirEntry | typeof PARENT_ROW>
  cursor: number
  selected: Set<string>
  focused: boolean
  density: RowDensity
  platform: NodePlatform
  sort: { column: SortColumn; direction: 'asc' | 'desc' }
  onSort: (column: SortColumn) => void
  onRowClick: (index: number, event: MouseEvent) => void
  onRowDoubleClick: (index: number) => void
  onFocus: () => void
}

const COLUMNS: Array<{ id: SortColumn; label: string; className: string }> = [
  { id: 'name', label: 'Name', className: 'flex-1 min-w-0' },
  { id: 'ext', label: 'Ext', className: 'w-[52px] shrink-0 text-right' },
  { id: 'size', label: 'Size', className: 'w-[84px] shrink-0 text-right' },
  { id: 'mtime', label: 'Modified', className: 'w-[124px] shrink-0 text-right' }
]

export function FileTable(props: FileTableProps): ReactNode {
  const { rows, cursor, selected, focused, density, platform, sort } = props
  const rowHeight = density === 'compact' ? 22 : 26
  const containerRef = useRef<HTMLDivElement>(null)

  // Keyboard navigation must keep the cursor row on screen.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const row = container.querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center h-5 px-space-md bg-surface-container-high border-y border-outline-variant/30 shrink-0">
        {COLUMNS.map((column) => (
          <button
            key={column.id}
            type="button"
            onClick={() => props.onSort(column.id)}
            className={`flex items-center gap-space-2xs font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider transition-colors ${
              sort.column === column.id
                ? 'text-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            } ${column.className} ${column.id === 'name' ? 'justify-start' : 'justify-end'}`}
          >
            {column.label}
            {sort.column === column.id && (
              <Icon name={sort.direction === 'asc' ? 'arrow_downward' : 'arrow_upward'} size={11} />
            )}
          </button>
        ))}
        <span className="w-[92px] shrink-0 text-right font-data-tabular-sm text-data-tabular-sm uppercase tracking-wider text-on-surface-variant">
          {platform === 'win32' ? 'Attr' : 'Perms'}
        </span>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto omni-scroll"
        onMouseDown={props.onFocus}
      >
        {rows.map((row, index) => (
          <Row
            key={row === PARENT_ROW ? '..' : row.path}
            row={row}
            index={index}
            height={rowHeight}
            isCursor={index === cursor}
            isSelected={row !== PARENT_ROW && selected.has(row.path)}
            paneFocused={focused}
            onClick={props.onRowClick}
            onDoubleClick={props.onRowDoubleClick}
          />
        ))}
      </div>
    </div>
  )
}

function Row({
  row,
  index,
  height,
  isCursor,
  isSelected,
  paneFocused,
  onClick,
  onDoubleClick
}: {
  row: DirEntry | typeof PARENT_ROW
  index: number
  height: number
  isCursor: boolean
  isSelected: boolean
  paneFocused: boolean
  onClick: (index: number, event: MouseEvent) => void
  onDoubleClick: (index: number) => void
}): ReactNode {
  const isParent = row === PARENT_ROW

  // Selection reads differently in the inactive pane so the focus is unambiguous.
  const background = isSelected
    ? paneFocused
      ? 'bg-primary-container/15'
      : 'bg-surface-container-highest/40'
    : isCursor && paneFocused
      ? 'bg-surface-container-high/70'
      : 'hover:bg-surface-container-high/50'

  const accent = isSelected
    ? paneFocused
      ? 'border-l-2 border-primary-container'
      : 'border-l-2 border-outline'
    : isCursor
      ? 'border-l-2 border-outline-variant'
      : 'border-l-2 border-transparent'

  return (
    <div
      data-row-index={index}
      onClick={(event) => onClick(index, event)}
      onDoubleClick={() => onDoubleClick(index)}
      className={`flex items-center px-space-md ${background} ${accent} transition-colors duration-[80ms] cursor-default`}
      style={{ height: `${height}px` }}
    >
      {isParent ? (
        <>
          <span className="flex-1 min-w-0 flex items-center gap-space-sm">
            <Icon name="drive_folder_upload" size={14} className="text-on-surface-variant" />
            <span className="font-data-tabular-md text-data-tabular-md text-on-surface-variant">
              ..
            </span>
          </span>
          <span className="w-[52px] shrink-0 text-right font-data-tabular-sm text-data-tabular-sm text-outline">
            UP
          </span>
          <span className="w-[84px] shrink-0 text-right font-data-tabular-md text-data-tabular-md text-outline">
            &lt;DIR&gt;
          </span>
          <span className="w-[124px] shrink-0 text-right font-data-tabular-md text-data-tabular-md text-outline">
            --
          </span>
          <span className="w-[92px] shrink-0" />
        </>
      ) : (
        <>
          <span className="flex-1 min-w-0 flex items-center gap-space-sm">
            <Icon
              name={iconForEntry(row.name, row.ext, row.isDir)}
              size={14}
              className={
                row.isDir ? 'text-primary shrink-0' : `${extTone(row.ext)} shrink-0 opacity-80`
              }
            />
            <span
              title={row.name}
              className={`truncate font-body-md text-body-md ${
                row.hidden ? 'text-on-surface-variant' : 'text-on-surface'
              } ${row.symlink ? 'italic' : ''}`}
            >
              {middleEllipsis(row.name, 72)}
              {row.isDir && <span className="text-on-surface-variant">/</span>}
            </span>
          </span>
          <span
            className={`w-[52px] shrink-0 text-right font-data-tabular-sm text-data-tabular-sm uppercase ${
              row.isDir ? 'text-outline' : extTone(row.ext)
            }`}
          >
            {row.isDir ? 'DIR' : row.ext}
          </span>
          <span className="w-[84px] shrink-0 text-right font-data-tabular-md text-data-tabular-md text-on-surface-variant">
            {row.isDir ? <span className="text-outline">&lt;DIR&gt;</span> : formatBytes(row.size)}
          </span>
          <span className="w-[124px] shrink-0 text-right font-data-tabular-md text-data-tabular-md text-on-surface-variant">
            {formatMtime(row.mtimeMs)}
          </span>
          <span className="w-[92px] shrink-0 text-right font-data-tabular-sm text-data-tabular-sm text-outline">
            {row.mode}
          </span>
        </>
      )}
    </div>
  )
}
