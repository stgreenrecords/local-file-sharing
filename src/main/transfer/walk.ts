/**
 * Expands a user selection into a flat list of file-sized transfer units.
 *
 * The whole tree is measured before the first byte moves, so totals and ETA are
 * real numbers rather than a guess that drifts as the copy proceeds.
 */
import type { DirEntry, NodePlatform, PathRef, Settings } from '@shared/types'
import { ErrorCode, OmniError } from '@shared/errors'
import { basenameFor, isPlatformJunk, joinFor, sanitizeLeaf } from '@shared/paths'
import type { FsProvider } from '../fs/provider'

export interface WalkUnit {
  source: PathRef
  target: PathRef
  /** Path relative to the selection root; what the queue view shows. */
  relativePath: string
  size: number
  mtimeMs: number
}

export interface WalkResult {
  units: WalkUnit[]
  /** Directories to create on the target, parents first. */
  directories: string[]
  totalBytes: number
  /** Non-fatal problems: unreadable folders, sanitised-name collisions. */
  warnings: Array<{ path: string; message: string }>
}

interface WalkContext {
  source: FsProvider
  target: FsProvider
  settings: Settings
  /** Guards against symlink loops on the source side. */
  seen: Set<string>
}

/**
 * Renames a leaf for the target platform and reports a collision rather than
 * letting two sanitised names silently overwrite each other.
 */
function targetLeaf(
  name: string,
  targetPlatform: NodePlatform,
  settings: Settings,
  taken: Set<string>,
  warnings: WalkResult['warnings'],
  sourcePath: string
): string | null {
  const leaf = sanitizeLeaf(name, targetPlatform, {
    sanitizeWindowsNames: settings.sanitizeWindowsNames,
    normalizeUnicode: settings.normalizeUnicode
  })
  const key = targetPlatform === 'win32' ? leaf.toLowerCase() : leaf
  if (taken.has(key)) {
    warnings.push({
      path: sourcePath,
      message: `"${name}" becomes "${leaf}" on the target, which is already taken by a sibling`
    })
    return null
  }
  taken.add(key)
  return leaf
}

export async function walk(
  sources: PathRef[],
  targetDir: PathRef,
  ctx: WalkContext
): Promise<WalkResult> {
  const result: WalkResult = { units: [], directories: [], totalBytes: 0, warnings: [] }
  const rootTaken = new Set<string>()

  for (const source of sources) {
    const entry = await ctx.source.stat(source.path)
    const leaf = targetLeaf(
      entry.name || basenameFor(ctx.source.platform, source.path),
      ctx.target.platform,
      ctx.settings,
      rootTaken,
      result.warnings,
      source.path
    )
    if (leaf === null) continue

    if (ctx.settings.stripMacMetadata && isPlatformJunk(entry.name, ctx.target.platform)) continue

    const targetPath = joinFor(ctx.target.platform, targetDir.path, leaf)
    if (entry.isDir) {
      result.directories.push(targetPath)
      await descend(source.path, targetPath, leaf, ctx, result)
    } else {
      result.units.push({
        source: { nodeId: source.nodeId, path: source.path },
        target: { nodeId: targetDir.nodeId, path: targetPath },
        relativePath: leaf,
        size: entry.size,
        mtimeMs: entry.mtimeMs
      })
      result.totalBytes += entry.size
    }
  }

  if (result.units.length === 0 && result.directories.length === 0) {
    throw new OmniError(ErrorCode.NOT_FOUND, 'Nothing to transfer in the selection')
  }
  return result
}

async function descend(
  sourceDir: string,
  targetDir: string,
  relativePrefix: string,
  ctx: WalkContext,
  result: WalkResult
): Promise<void> {
  // A symlinked directory that points back up its own tree would recurse forever.
  const key = `${ctx.source.nodeId}:${sourceDir}`
  if (ctx.seen.has(key)) {
    result.warnings.push({ path: sourceDir, message: 'Skipped: symlink loop' })
    return
  }
  ctx.seen.add(key)

  let entries: DirEntry[]
  try {
    entries = await ctx.source.list(sourceDir)
  } catch (err) {
    result.warnings.push({
      path: sourceDir,
      message: err instanceof Error ? err.message : 'Could not read directory'
    })
    return
  }

  const taken = new Set<string>()
  for (const entry of entries) {
    // Hidden files always copy: `showHidden` is a listing preference, not an
    // exclusion filter. Only true cross-platform junk is dropped.
    if (ctx.settings.stripMacMetadata && isPlatformJunk(entry.name, ctx.target.platform)) continue

    const leaf = targetLeaf(
      entry.name,
      ctx.target.platform,
      ctx.settings,
      taken,
      result.warnings,
      entry.path
    )
    if (leaf === null) continue

    const childTarget = joinFor(ctx.target.platform, targetDir, leaf)
    const childRelative = `${relativePrefix}/${leaf}`

    if (entry.isDir) {
      result.directories.push(childTarget)
      await descend(entry.path, childTarget, childRelative, ctx, result)
    } else {
      result.units.push({
        source: { nodeId: ctx.source.nodeId, path: entry.path },
        target: { nodeId: ctx.target.nodeId, path: childTarget },
        relativePath: childRelative,
        size: entry.size,
        mtimeMs: entry.mtimeMs
      })
      result.totalBytes += entry.size
    }
  }
}
