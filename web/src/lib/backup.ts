// Backup / restore of HE80 regions as JSON. Same `regions` hex format as the he80-test.html backups, so those load too.
// The HE80 has no on-board profiles; these files double as profiles.

import { WRITES, type Transport } from './hid.ts'
import { REGIONS, decodeInfo, type RegionName } from './protocol.ts'

export type Regions = Partial<Record<RegionName, Uint8Array>>
export interface Backup { date: string; regions: Regions }
type Io = Pick<Transport, 'read' | 'write'>

const NAMES = Object.keys(REGIONS) as RegionName[]
// DKS slots and macros before the key map/Fn layer that point at them.
const RESTORE_ORDER: RegionName[] = ['settings', 'rt', 'dks', 'macros', 'fnLayer', 'keymap']

const hex = (d: Uint8Array) => Array.from(d, x => x.toString(16).padStart(2, '0')).join(' ')
export const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

export async function readAll(t: Io): Promise<Regions> {
  const out: Regions = {}
  for (const name of NAMES) out[name] = await t.read(REGIONS[name].read, REGIONS[name].size)
  return out
}

export function toJson(b: Backup): string {
  const regions = Object.fromEntries(Object.entries(b.regions).map(([k, v]) => [k, hex(v)]))
  const info = b.regions.info && decodeInfo(b.regions.info)
  return JSON.stringify({ format: 'he80-driver-backup', version: 1, date: b.date, firmware: info?.firmware, productNum: info?.productNum, regions }, null, 2)
}

/** Parses a backup file. Throws a readable error for anything that isn't a valid HE80 backup. */
export function fromJson(text: string): Backup {
  let j: unknown
  try { j = JSON.parse(text) } catch { throw new Error('not a JSON file') }
  const src = (j as { regions?: unknown })?.regions
  if (!src || typeof src !== 'object') throw new Error('no "regions" in this file; not an HE80 backup')
  const regions: Regions = {}
  for (const name of NAMES) {
    const v = (src as Record<string, unknown>)[name]
    if (v === undefined) continue
    const parts = typeof v === 'string' ? v.trim().split(/\s+/) : []
    if (parts.length !== REGIONS[name].size || !parts.every(x => /^[0-9a-f]{2}$/i.test(x)))
      throw new Error(`region "${name}" must be ${REGIONS[name].size} hex bytes`)
    regions[name] = Uint8Array.from(parts, x => parseInt(x, 16))
  }
  if (!Object.keys(regions).length) throw new Error('backup contains no known regions')
  if (regions.info && !decodeInfo(regions.info).known) throw new Error('backup is from a different keyboard (productNum not HE80)')
  return { date: String((j as { date?: unknown }).date ?? ''), regions }
}

export type WritableRegion = Exclude<RegionName, 'info'>

/**
 * Writes one region safely: refuses if the keyboard no longer holds `before` (another app changed it since we read),
 * then writes `after` and reads it back to confirm the keyboard kept it.
 */
export async function writeVerified(t: Io, name: WritableRegion, before: Uint8Array, after: Uint8Array) {
  const reg = REGIONS[name]
  if (after.length !== reg.size) throw new Error(`${name} must be ${reg.size} bytes`)
  if (!equal(await t.read(reg.read, reg.size), before))
    throw new Error('The keyboard’s settings changed since they were read, maybe by another app. Click “Read again”, then redo your change.')
  await t.write(reg.write, after)
  if (!equal(await t.read(reg.read, reg.size), after))
    throw new Error('The keyboard didn’t keep the new values. Click “Read again” to see what it has now.')
}

export interface RestoreReport { written: RegionName[]; unchanged: RegionName[]; notAllowed: RegionName[] }

/**
 * Writes every region of the backup that differs from the keyboard, then reads it back to verify.
 * Regions whose write command isn't enabled yet are skipped and reported, never forced.
 */
export async function restore(t: Io, b: Backup): Promise<RestoreReport> {
  const r: RestoreReport = { written: [], unchanged: [], notAllowed: [] }
  for (const name of RESTORE_ORDER) {
    const want = b.regions[name]
    if (!want) continue
    const reg = REGIONS[name] as { read: number; write: number; size: number }
    const now = await t.read(reg.read, reg.size)
    if (equal(now, want)) { r.unchanged.push(name); continue }
    if (!WRITES.has(reg.write)) { r.notAllowed.push(name); continue }
    await t.write(reg.write, want)
    if (!equal(await t.read(reg.read, reg.size), want)) throw new Error(`verify failed after writing ${name}`)
    r.written.push(name)
  }
  return r
}

// ---- Automatic backup before the first write of a session --------------------------------------------------------

const AUTO_KEY = 'he80-auto-backups'
const AUTO_KEEP = 5

const sameRegions = (a: Regions, b: Regions) => {
  const keys = Object.keys(a) as RegionName[]
  return keys.length === Object.keys(b).length && keys.every(k => b[k] && equal(a[k]!, b[k]!))
}

/**
 * Saves `regions` as the newest auto backup (keeps the last 5). Skipped when they match the newest one already
 * kept, so reconnecting without changes doesn't push older backups out. Returns false if storage is unavailable.
 */
export function saveAutoBackup(regions: Regions, storage: Storage = localStorage, date = new Date().toISOString()): boolean {
  try {
    const kept = listAutoBackups(storage)
    if (kept[0] && sameRegions(kept[0].regions, regions)) return true
    const list = [toJson({ date, regions }), ...kept.map(toJson)].slice(0, AUTO_KEEP)
    storage.setItem(AUTO_KEY, JSON.stringify(list))
    return true
  } catch {
    return false
  }
}

export function listAutoBackups(storage: Storage = localStorage): Backup[] {
  try {
    return (JSON.parse(storage.getItem(AUTO_KEY) ?? '[]') as string[]).map(fromJson)
  } catch {
    return []
  }
}

/** Starts a browser download of the backup. */
export function downloadBackup(b: Backup) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([toJson(b)], { type: 'application/json' }))
  a.download = `he80-backup-${b.date.replace(/[:.]/g, '-')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
