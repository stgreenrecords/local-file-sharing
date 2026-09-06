/**
 * Cross-platform path arithmetic is the easiest thing in this codebase to break
 * silently — a wrong join produces a plausible-looking path that writes to the
 * wrong place. These cases run on every platform, for both platforms.
 */
import { describe, expect, it } from 'vitest'
import {
  applyMapping,
  basenameFor,
  dirnameFor,
  extOf,
  isAbsoluteFor,
  isPlatformJunk,
  isRootFor,
  joinFor,
  looksNativeTo,
  middleEllipsis,
  sanitizeLeaf,
  segmentsFor,
  sepFor
} from './paths'

describe('sepFor', () => {
  it('uses backslash for win32 and slash elsewhere', () => {
    expect(sepFor('win32')).toBe('\\')
    expect(sepFor('darwin')).toBe('/')
    expect(sepFor('linux')).toBe('/')
  })
})

describe('joinFor on win32', () => {
  it('joins onto a drive root', () => {
    expect(joinFor('win32', 'C:\\', 'Users')).toBe('C:\\Users')
  })
  it('joins several segments', () => {
    expect(joinFor('win32', 'C:\\Users', 'Viach', 'Documents')).toBe('C:\\Users\\Viach\\Documents')
  })
  it('adds the root separator to a bare drive letter', () => {
    expect(joinFor('win32', 'C:', 'x')).toBe('C:\\x')
  })
  it('normalises pasted forward slashes', () => {
    expect(joinFor('win32', 'C:/Users/Viach', 'a')).toBe('C:\\Users\\Viach\\a')
  })
  it('pops a segment for ..', () => {
    expect(joinFor('win32', 'C:\\a\\b', '..', 'c')).toBe('C:\\a\\c')
  })
  it('refuses to escape the drive root', () => {
    expect(joinFor('win32', 'C:\\', '..', '..')).toBe('C:\\')
  })
  it('drops .', () => {
    expect(joinFor('win32', 'C:\\a', '.', 'b')).toBe('C:\\a\\b')
  })
  it('joins onto a UNC share', () => {
    expect(joinFor('win32', '\\\\server\\share', 'dir')).toBe('\\\\server\\share\\dir')
  })
  it('refuses to escape a UNC share root', () => {
    expect(joinFor('win32', '\\\\server\\share', '..', '..', '..')).toBe('\\\\server\\share')
  })
})

describe('joinFor on posix', () => {
  it('joins onto the root', () => {
    expect(joinFor('darwin', '/', 'Users')).toBe('/Users')
  })
  it('joins several segments', () => {
    expect(joinFor('darwin', '/Users/alex', 'Projects', 'app')).toBe('/Users/alex/Projects/app')
  })
  it('pops a segment for ..', () => {
    expect(joinFor('darwin', '/a/b/c', '..')).toBe('/a/b')
  })
  it('refuses to escape the root', () => {
    expect(joinFor('darwin', '/', '..', '..')).toBe('/')
  })
  it('collapses repeated separators', () => {
    expect(joinFor('darwin', '/a//b', 'c')).toBe('/a/b/c')
  })
  it('preserves spaces in names', () => {
    expect(joinFor('darwin', '/Volumes', 'My Disk')).toBe('/Volumes/My Disk')
  })
})

describe('dirnameFor', () => {
  it.each([
    ['win32', 'C:\\a\\b\\c.txt', 'C:\\a\\b'],
    ['win32', 'C:\\a', 'C:\\'],
    ['win32', 'C:\\', 'C:\\'],
    ['win32', 'C:\\a\\b\\', 'C:\\a'],
    ['win32', '\\\\server\\share', '\\\\server\\share'],
    ['win32', '\\\\server\\share\\dir', '\\\\server\\share'],
    ['darwin', '/a/b/c.txt', '/a/b'],
    ['darwin', '/a', '/'],
    ['darwin', '/', '/'],
    ['darwin', '/a/b/', '/a']
  ] as const)('%s %s -> %s', (platform, input, expected) => {
    expect(dirnameFor(platform, input)).toBe(expected)
  })
})

describe('basenameFor', () => {
  it.each([
    ['win32', 'C:\\a\\b.txt', 'b.txt'],
    ['win32', 'C:\\', 'C:\\'],
    ['darwin', '/a/b.txt', 'b.txt'],
    ['darwin', '/', '/'],
    ['darwin', '/a/b/', 'b']
  ] as const)('%s %s -> %s', (platform, input, expected) => {
    expect(basenameFor(platform, input)).toBe(expected)
  })
})

describe('isRootFor', () => {
  it.each([
    ['win32', 'C:\\', true],
    ['win32', 'C:', true],
    ['win32', 'C:\\Users', false],
    ['win32', '\\\\server\\share', true],
    ['win32', '\\\\server\\share\\a', false],
    ['darwin', '/', true],
    ['darwin', '/Users', false]
  ] as const)('%s %s -> %s', (platform, input, expected) => {
    expect(isRootFor(platform, input)).toBe(expected)
  })
})

describe('isAbsoluteFor', () => {
  it.each([
    ['win32', 'C:\\x', true],
    ['win32', 'x\\y', false],
    ['win32', '\\\\srv\\s', true],
    ['darwin', '/x', true],
    ['darwin', 'x/y', false]
  ] as const)('%s %s -> %s', (platform, input, expected) => {
    expect(isAbsoluteFor(platform, input)).toBe(expected)
  })
})

describe('segmentsFor', () => {
  it('builds win32 breadcrumbs from the drive down', () => {
    expect(segmentsFor('win32', 'C:\\Users\\Viach')).toEqual([
      { label: 'C:', path: 'C:\\' },
      { label: 'Users', path: 'C:\\Users' },
      { label: 'Viach', path: 'C:\\Users\\Viach' }
    ])
  })
  it('handles a bare drive root', () => {
    expect(segmentsFor('win32', 'C:\\')).toEqual([{ label: 'C:', path: 'C:\\' }])
  })
  it('treats a UNC share as one root token', () => {
    expect(segmentsFor('win32', '\\\\srv\\share\\a')).toEqual([
      { label: '\\\\srv\\share', path: '\\\\srv\\share' },
      { label: 'a', path: '\\\\srv\\share\\a' }
    ])
  })
  it('builds posix breadcrumbs from /', () => {
    expect(segmentsFor('darwin', '/Users/alex')).toEqual([
      { label: '/', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: 'alex', path: '/Users/alex' }
    ])
  })
  it('handles the posix root alone', () => {
    expect(segmentsFor('darwin', '/')).toEqual([{ label: '/', path: '/' }])
  })
})

describe('extOf', () => {
  it.each([
    ['clip.MOV', false, 'mov'],
    ['archive.tar.gz', false, 'gz'],
    ['.DS_Store', false, ''],
    ['weird.', false, ''],
    ['README', false, ''],
    ['folder.d', true, '']
  ] as const)('%s (isDir=%s) -> %s', (name, isDir, expected) => {
    expect(extOf(name, isDir)).toBe(expected)
  })
})

describe('sanitizeLeaf', () => {
  const win = { sanitizeWindowsNames: true, normalizeUnicode: false }

  it('replaces every character NTFS rejects', () => {
    expect(sanitizeLeaf('a:b*c?d"e<f>g|h', 'win32', win)).toBe('a_b_c_d_e_f_g_h')
  })
  it('strips trailing dots and spaces', () => {
    expect(sanitizeLeaf('name.', 'win32', win)).toBe('name')
    expect(sanitizeLeaf('name ', 'win32', win)).toBe('name')
  })
  it('escapes reserved device names, with or without an extension', () => {
    expect(sanitizeLeaf('CON', 'win32', win)).toBe('_CON')
    expect(sanitizeLeaf('nul.txt', 'win32', win)).toBe('_nul.txt')
  })
  it('never produces an empty name', () => {
    expect(sanitizeLeaf('...', 'win32', win)).toBe('_')
  })
  it('leaves a legal name untouched', () => {
    expect(sanitizeLeaf('Final Cut v2.mov', 'win32', win)).toBe('Final Cut v2.mov')
  })
  it('leaves posix targets alone — those characters are legal there', () => {
    expect(sanitizeLeaf('a:b*c', 'darwin', win)).toBe('a:b*c')
  })

  const unicode = { sanitizeWindowsNames: false, normalizeUnicode: true }
  const nfc = 'caf\u00e9'
  const nfd = 'cafe\u0301'

  it('composes to NFC for Windows targets', () => {
    expect(sanitizeLeaf(nfd, 'win32', unicode)).toBe(nfc)
  })
  it('decomposes to NFD for macOS targets', () => {
    expect(sanitizeLeaf(nfc, 'darwin', unicode)).toBe(nfd)
  })
})

describe('isPlatformJunk', () => {
  it.each([
    ['.DS_Store', 'win32', true],
    ['._clip.mov', 'win32', true],
    ['clip.mov', 'win32', false],
    ['Thumbs.db', 'darwin', true],
    ['desktop.ini', 'darwin', true],
    ['.DS_Store', 'darwin', false]
  ] as const)('%s -> %s is junk: %s', (name, target, expected) => {
    expect(isPlatformJunk(name, target)).toBe(expected)
  })
})

describe('middleEllipsis', () => {
  const long = '/Users/alexander/Projects/Client-Media-Assets/release.tar.gz'

  it('passes short values through', () => {
    expect(middleEllipsis('short.txt', 20)).toBe('short.txt')
  })
  it('stays within the budget and keeps both ends', () => {
    const trimmed = middleEllipsis(long, 30)
    expect(trimmed.length).toBeLessThanOrEqual(30)
    expect(trimmed.startsWith('/Users')).toBe(true)
    expect(trimmed.endsWith('.gz')).toBe(true)
    expect(trimmed).toContain('...')
  })
})

describe('applyMapping', () => {
  const maps = [{ windows: 'D:\\PostProduction', posix: '/Volumes/Post' }]

  it('maps an exact win32 path to posix', () => {
    expect(applyMapping('D:\\PostProduction', 'win32', 'darwin', maps)).toBe('/Volumes/Post')
  })
  it('maps a subpath in both directions', () => {
    expect(applyMapping('D:\\PostProduction\\Reel01\\a.mov', 'win32', 'darwin', maps)).toBe(
      '/Volumes/Post/Reel01/a.mov'
    )
    expect(applyMapping('/Volumes/Post/Reel01/a.mov', 'darwin', 'win32', maps)).toBe(
      'D:\\PostProduction\\Reel01\\a.mov'
    )
  })
  it('ignores case on the Windows side', () => {
    expect(applyMapping('d:\\postproduction\\x', 'win32', 'darwin', maps)).toBe('/Volumes/Post/x')
  })
  it('returns null when no rule matches', () => {
    expect(applyMapping('E:\\Other', 'win32', 'darwin', maps)).toBeNull()
  })
  it('returns null when both sides are the same platform', () => {
    expect(applyMapping('D:\\PostProduction', 'win32', 'win32', maps)).toBeNull()
  })
})

describe('looksNativeTo', () => {
  it('accepts a path shaped like its own platform', () => {
    expect(looksNativeTo('win32', 'C:\\x')).toBe(true)
    expect(looksNativeTo('darwin', '/x')).toBe(true)
  })
  it('rejects a path shaped like the other platform', () => {
    expect(looksNativeTo('win32', '/etc/passwd')).toBe(false)
    expect(looksNativeTo('darwin', 'C:\\x')).toBe(false)
  })
  it('rejects empty paths and embedded NUL bytes', () => {
    expect(looksNativeTo('darwin', '')).toBe(false)
    expect(looksNativeTo('darwin', '/a\u0000b')).toBe(false)
  })
})
