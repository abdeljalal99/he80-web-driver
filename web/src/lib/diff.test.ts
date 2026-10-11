import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fromJson } from './backup.ts'
import { diffRegions } from './diff.ts'

const root = new URL('../../test/', import.meta.url) // test fixture: a real backup of the HE80
const backup = fromJson(readFileSync(new URL(readdirSync(root).find(f => /^he80-backup-.*\.json$/.test(f))!, root), 'utf8'))
const copy = () => Object.fromEntries(Object.entries(backup.regions).map(([k, v]) => [k, v!.slice()]))

test('identical regions: nothing to restore', () => {
  assert.deepEqual(diffRegions(backup.regions, copy()), [])
})

test('describes each change in plain words and marks what cannot be written yet', () => {
  const now = copy()
  now.rt![8 * 34 + 2] = 120 // W: actuation 0.10 → 1.20 on the keyboard now
  now.rt![8 * 34 + 4] = 0 // W: rapid trigger off
  now.rt![8 * 34 + 6] = 0
  now.keymap![48 * 4 + 2] = 0x39 // Caps sends Caps now (backup: F16)
  now.settings![5] = 4 // 2000 Hz now (backup: 4000)

  const d = diffRegions(now, backup.regions)
  assert.deepEqual(d.map(g => [g.region, g.allowed]), [['rt', true], ['keymap', true], ['settings', true]])
  assert.deepEqual(d[0].lines, ['W: actuation 1.20 → 0.10 mm, rapid trigger off → 0.10'])
  assert.deepEqual(d[1].lines, ['Caps: Caps → F16'])
  assert.deepEqual(d[2].lines, ['Polling rate 2000 → 4000 Hz'])
})

test('a key going back to its original mapping is named as such', () => {
  const want = copy()
  want.keymap![48 * 4] = 0; want.keymap![48 * 4 + 2] = 0 // backup has Caps unmapped
  assert.deepEqual(diffRegions(backup.regions, want)[0].lines, ['Caps: F16 → original key'])
})

test('keys with the same change share one line', () => {
  const want = copy()
  for (let k = 0; k < 128; k++) if (want.rt![8 * k + 4]) { want.rt![8 * k + 4] = 4; want.rt![8 * k + 6] = 4 }
  assert.deepEqual(diffRegions(backup.regions, want)[0].lines, ['All 82 keys: rapid trigger 0.10 → 0.04'])
  const wasd = copy()
  for (const k of [34, 49, 50, 51]) wasd.rt![8 * k + 2] = 200
  assert.deepEqual(diffRegions(backup.regions, wasd)[0].lines, ['W, A, S, D: actuation 0.10 → 2.00 mm'])
})
