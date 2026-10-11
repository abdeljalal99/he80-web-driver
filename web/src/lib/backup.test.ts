import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { WRITES } from './hid.ts'
import { REGIONS } from './protocol.ts'
import { fromJson, listAutoBackups, readAll, restore, saveAutoBackup, toJson, writeVerified } from './backup.ts'

const root = new URL('../../test/', import.meta.url) // test fixture: a real backup of the HE80
const oldBackup = readFileSync(new URL(readdirSync(root).find(f => /^he80-backup-.*\.json$/.test(f))!, root), 'utf8')

// In-memory keyboard with the same allowlist as the real transport.
function fakeIo(regions: Record<number, Uint8Array>) {
  const writes: number[] = []
  return {
    writes,
    async read(cmd: number) { return regions[cmd].slice() },
    async write(cmd: number, b: Uint8Array) {
      if (!WRITES.has(cmd)) throw new Error('refusing')
      writes.push(cmd)
      regions[cmd - 0x10] = b.slice()
    },
  }
}

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
}

test('the he80-test.html backup loads, and our format round-trips', () => {
  const b = fromJson(oldBackup)
  assert.deepEqual(Object.keys(b.regions).sort(), Object.keys(REGIONS).sort())
  assert.equal(b.regions.keymap![48 * 4 + 2], 0x6b) // Caps → F16
  const again = fromJson(toJson(b))
  assert.deepEqual(again, b)
  assert.equal(JSON.parse(toJson(b)).firmware, '1.08')
})

test('invalid files are refused with a readable reason', () => {
  assert.throws(() => fromJson('nope'), /not a JSON file/)
  assert.throws(() => fromJson('{}'), /no "regions"/)
  assert.throws(() => fromJson('{"regions":{"rt":"00 01"}}'), /"rt" must be 1024 hex bytes/)
  assert.throws(() => fromJson('{"regions":{"lighting":"00"}}'), /no known regions/)
  const j = JSON.parse(oldBackup)
  j.regions.info = j.regions.info.replace(/^((?:\S+ ){14})04 10/, '$100 00') // productNum 0
  assert.throws(() => fromJson(JSON.stringify(j)), /different keyboard/)
})

test('restore writes only changed, allowed regions, verifies, and reports the rest', async () => {
  const b = fromJson(oldBackup)
  const board: Record<number, Uint8Array> = {}
  for (const [name, r] of Object.entries(REGIONS)) board[r.read] = b.regions[name as keyof typeof REGIONS]!.slice()
  board[0x12][4 * 103] = 2 // keymap differs → written
  board[0x15][0] = 1 // macros differ → written too
  const io = fakeIo(board)
  const r = await restore(io, b)
  assert.deepEqual(r.written, ['macros', 'keymap'])
  assert.deepEqual(r.notAllowed, [])
  assert.deepEqual(r.unchanged, ['settings', 'rt', 'dks', 'fnLayer'])
  assert.deepEqual(io.writes, [0x25, 0x22])
  assert.deepEqual(board[0x12], b.regions.keymap)
  assert.deepEqual(await readAll(io), b.regions)
})

test('auto backups keep the newest 5, skip repeats of the newest, and survive broken storage', () => {
  const s = new MemStorage() as unknown as Storage
  const regions = fromJson(oldBackup).regions
  const variant = (i: number) => ({ ...regions, rt: regions.rt!.map((b, j) => (j === 2 ? i : b)) })
  for (let i = 0; i < 7; i++) assert.ok(saveAutoBackup(variant(i), s, `2026-10-1${i}`))
  assert.deepEqual(listAutoBackups(s).map(b => b.date), ['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12'])
  assert.ok(saveAutoBackup(variant(6), s, '2026-10-20')) // same as newest: not added again
  assert.equal(listAutoBackups(s)[0].date, '2026-10-16')
  assert.ok(saveAutoBackup(variant(1), s, '2026-10-21')) // different: added
  assert.equal(listAutoBackups(s)[0].date, '2026-10-21')
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } } as unknown as Storage
  assert.equal(saveAutoBackup(regions, broken), false)
  assert.deepEqual(listAutoBackups(broken), [])
})

test('writeVerified: writes and verifies; refuses if the keyboard changed; reports a write that did not stick', async () => {
  const b = fromJson(oldBackup)
  const before = b.regions.rt!
  const after = before.slice()
  after[8 * 87 + 2] = 200
  const board: Record<number, Uint8Array> = { 0x17: before.slice() }
  const io = fakeIo(board)
  await writeVerified(io, 'rt', before, after)
  assert.deepEqual(board[0x17], after)

  await assert.rejects(writeVerified(io, 'rt', before, after), /changed since they were read/) // board now holds `after`
  assert.deepEqual(io.writes, [0x27])

  const deaf = { ...fakeIo({ 0x17: before.slice() }), async write() {} } // acks but keeps old data
  await assert.rejects(writeVerified(deaf, 'rt', before, after), /didn’t keep the new values/)
  await assert.rejects(writeVerified(io, 'rt', after, after.subarray(0, 8)), /must be 1024 bytes/)
})
