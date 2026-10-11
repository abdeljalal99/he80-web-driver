import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import * as p from './protocol.ts'
import { KEYS, ROWS, usageName } from './keys.ts'

// The real stage-1 backup in the repo root is the reference data.
const root = new URL('../../test/', import.meta.url) // test fixture: a real backup of the HE80
const file = readdirSync(root).find(f => /^he80-backup-.*\.json$/.test(f))!
const backup = JSON.parse(readFileSync(new URL(file, root), 'utf8'))
const raw = (name: string) => Uint8Array.from(backup.regions[name].split(' '), (x: string) => parseInt(x, 16))

test('every region re-encodes byte-identical from the backup', () => {
  const s = raw('settings'), km = raw('keymap'), fn = raw('fnLayer'), rt = raw('rt'), dks = raw('dks'), mac = raw('macros')
  assert.deepEqual(p.encodeSettings(s, p.decodeSettings(s)), s)
  assert.deepEqual(p.encodeKeymap(km, p.decodeKeymap(km)), km)
  assert.deepEqual(p.encodeKeymap(fn, p.decodeKeymap(fn)), fn)
  assert.deepEqual(p.encodeRt(rt, p.decodeRt(rt)), rt)
  assert.deepEqual(p.encodeDks(dks, p.decodeDks(dks)), dks)
  assert.deepEqual(p.encodeMacros(p.decodeMacros(mac)), mac)
})

test('decoded values match the real board setup', () => {
  assert.deepEqual(p.decodeInfo(raw('info')), { vid: 0x0c45, pid: 0x8092, firmware: '1.08', productNum: 4100, known: true, rtPrecision: 0 })
  assert.deepEqual(p.decodeSettings(raw('settings')),
    { pollingRate: 4000, topDeadZone: 0, bottomDeadZone: 0, stability: true, adaptiveCalibration: true })

  const rt = p.decodeRt(raw('rt'))
  for (const k of KEYS) {
    assert.deepEqual(rt[k.index], { switchType: 0, flags: 1, actuation: 10, press: 10, release: 10 }, k.label)
    assert.ok(p.fullTravel(rt[k.index]))
  }
  assert.deepEqual(rt[120], { switchType: 0, flags: 0, actuation: 120, press: 0, release: 0 }) // unused slot = 1.20 mm default

  const km = p.decodeKeymap(raw('keymap'))
  assert.deepEqual(km[48], { type: 'key', mods: 0, usage: 0x6b }) // Caps → F16
  assert.equal(usageName(0x6b), 'F16')
  assert.equal(km.filter(a => a.type !== 'default').length, 1)
  assert.ok(p.decodeKeymap(raw('fnLayer')).every(a => a.type === 'default'))
  assert.ok(p.decodeDks(raw('dks')).every(s => s === null))
  assert.ok(p.decodeMacros(raw('macros')).every(m => m === null))
})

test('settings write keeps bytes it does not understand (6, 15, …)', () => {
  const s = raw('settings')
  s[6] = 7; s[15] = 1; s[3] = 9
  const out = p.encodeSettings(s, { ...p.decodeSettings(s), pollingRate: 8000, topDeadZone: 30 })
  assert.deepEqual([out[3], out[5], out[6], out[8], out[15]], [9, 6, 7, 30, 1])
  assert.throws(() => p.encodeSettings(s, { ...p.decodeSettings(s), pollingRate: 500 }), /unsupported/)
})

test('every action type round-trips; odd bytes stay raw', () => {
  const actions: p.KeyAction[] = [
    { type: 'default' }, { type: 'mouse', kind: 3, value: 255 }, { type: 'key', mods: 2, usage: 4 },
    { type: 'consumer', usage: 547 }, { type: 'macro', index: 3, mode: 1, repeat: 5 }, { type: 'dks', slot: 39 },
    { type: 'mt', hold: 224, tap: 41, time: 20 }, { type: 'tgl', usage: 225 }, { type: 'socd', mode: 3, key1: 4, key2: 7 },
    { type: 'rs', key1: 4, key2: 7 }, { type: 'fn', id: 0x0100c8 }, { type: 'raw', bytes: [0x81, 2, 3, 4] },
  ]
  for (const a of actions) assert.deepEqual(p.decodeAction(p.encodeAction(a)), a, a.type)
  assert.deepEqual(p.decodeAction([2, 0, 4, 9]), { type: 'raw', bytes: [2, 0, 4, 9] }) // b3 should be 0 → keep raw
})

test('RT edit changes only the bytes of that key, flags bits 1–2 kept', () => {
  const r = raw('rt')
  r[8 * 87 + 1] = 0b111
  const keys = p.decodeRt(r)
  keys[87] = p.withFullTravel({ ...keys[87], actuation: 200, press: 30, release: 50 }, false)
  const out = p.encodeRt(r, keys)
  const changed = [...out.keys()].filter(i => out[i] !== r[i])
  assert.deepEqual(changed, [697, 698, 700, 702]) // RCtrl: flags bit0, actuation, press, release low bytes
  assert.equal(out[697], 0b110)
})

test('DKS slot and macros encode at the documented offsets', () => {
  const slots = p.decodeDks(new Uint8Array(1024))
  slots[2] = { points: [16, 30, 30, 16], keys: [4, 5, 0, 0], masks: [0x01, 0x10, 0x02, 0x00] }
  const d = p.encodeDks(new Uint8Array(1024), slots)
  assert.deepEqual([...d.subarray(32, 48)], [16, 30, 30, 16, 0, 4, 0, 5, 0, 0, 0, 0, 1, 0x10, 2, 0])
  assert.deepEqual(p.decodeDks(d), slots)
  assert.deepEqual(p.encodeDks(d, p.decodeDks(new Uint8Array(1024))), new Uint8Array(1024))

  const macros: p.Macro[] = Array(100).fill(null)
  macros[0] = [{ delay: 10, code: 4, flags: 0xb0 }, { delay: 300, code: 4, flags: 0x30 }]
  macros[5] = [{ delay: 5, code: 1, flags: 0x90 }]
  const m = p.encodeMacros(macros)
  assert.deepEqual([...m.subarray(0, 4)], [144, 1, 0, 0]) // macro 0 at 400
  assert.deepEqual([...m.subarray(20, 24)], [156, 1, 0, 0]) // macro 5 at 400 + 4 + 2·4 = 412
  assert.deepEqual([...m.subarray(400, 412)], [4, 0, 0, 0, 10, 0, 4, 0xb0, 44, 1, 4, 0x30])
  assert.deepEqual(p.decodeMacros(m), macros)
  assert.throws(() => p.encodeMacros([Array(160).fill({ delay: 5, code: 4, flags: 0xb0 })]), /do not fit/)
})

test('key layout: 82 keys, unique indices, within the 128-entry tables', () => {
  assert.equal(KEYS.length, 82)
  assert.equal(new Set(KEYS.map(k => k.index)).size, 82)
  assert.ok(KEYS.every(k => k.index < 128))
  assert.equal(KEYS.find(k => k.index === 48)?.usage, 57) // Caps
})

test('every row is 16u wide except the arrow row (15u + empty corner)', () => {
  const widths = ROWS.map(r => Math.round(r.reduce((s, k) => s + k.w + k.gap, 0) * 100) / 100)
  assert.deepEqual(widths, [16, 16, 16, 16, 15, 16])
})

test('reset to default keeps switch type and flag bits 1–2; clamp enforces HE80 limits', () => {
  const t = { switchType: 3, flags: 0b111, actuation: 10, press: 10, release: 30 }
  assert.deepEqual(p.resetTravel(t), { switchType: 3, flags: 0b110, actuation: 120, press: 0, release: 0 })
  assert.equal(p.clamp(2, p.TRAVEL.actuation), 10)
  assert.equal(p.clamp(999, p.TRAVEL.rt), 330)
  assert.equal(p.clamp(25.4, p.TRAVEL.rt), 25)
  assert.equal(p.clamp(NaN, p.TRAVEL.rt), 2)
  assert.equal(p.clamp(1, p.TRAVEL.rt), 2)
})

test('tap/hold and toggle encode in the official hub format', () => {
  // Hub (new): MT params [holdAction, clickAction, max(1, round(ms / 10))], TGL [toggleAction, 0, 0]
  assert.deepEqual(p.encodeAction({ type: 'mt', hold: 224, tap: 41, time: 200 / 10 }), [9, 224, 41, 20])
  assert.deepEqual(p.encodeAction({ type: 'tgl', usage: 26 }), [10, 26, 0, 0])
  assert.deepEqual([p.MT_TIME.min, p.MT_TIME.max, p.ADVANCED_MAX], [10, 1000, 40])
})

test('DKS stage states use the hub mask encoding (tap = bit n, hold = bit n+4)', () => {
  let s = p.newDksSlot(4)
  assert.deepEqual(p.encodeDks(new Uint8Array(1024), [s]).subarray(0, 16), Uint8Array.from([16, 30, 30, 16, 0, 4, 0, 0, 0, 0, 0, 0, 0x10, 0x10, 0x10, 0]))
  s = p.withDksState(s, 2, 1, 1) // key 3 taps at the bottom
  s = p.withDksState(s, 0, 2, 0) // key 1 released when lifting from the bottom
  assert.deepEqual(s.masks, [0x10, 0x14, 0, 0])
  assert.deepEqual([p.dksState(s, 0, 0), p.dksState(s, 2, 1), p.dksState(s, 2, 0)], [2, 1, 0])
  const km = Array.from({ length: 128 }, (): p.KeyAction => ({ type: 'default' }))
  km[5] = { type: 'dks', slot: 0 }
  assert.equal(p.freeDksSlot(km, [null, s, null]), 2)
})

test('DKS cells: click toggles a tap or removes a whole hold, drag sets a hold', () => {
  const row = (s: p.DksSlot) => [0, 1, 2, 3].map(n => p.dksState(s, 1, n))
  let s: p.DksSlot = { points: [16, 30, 30, 16], keys: [4, 7, 0, 0], masks: [0, 0, 0, 0] }
  s = p.toggleDksCell(s, 1, 3)
  assert.deepEqual(row(s), [0, 0, 0, 1]) // tap at release
  s = p.setDksHold(s, 1, 0, 3)
  assert.deepEqual(row(s), [2, 2, 2, 1]) // held press → lift, released at release (tap there kept)
  assert.deepEqual(row(p.toggleDksCell(s, 1, 1)), [0, 0, 0, 1]) // click inside the hold removes all of it
  assert.deepEqual(row(p.toggleDksCell(p.toggleDksCell(s, 1, 3), 1, 3)), [2, 2, 2, 1]) // tap toggles off and on
})

test('macro key entries encode as the hub writes them: [6, macro, mode, count]', () => {
  assert.deepEqual(p.encodeAction({ type: 'macro', index: 0, mode: 1, repeat: 3 }), [6, 0, 1, 3]) // play 3 times
  assert.deepEqual(p.encodeAction({ type: 'macro', index: 19, mode: 2, repeat: 1 }), [6, 19, 2, 1]) // until pressed again
  assert.deepEqual(p.decodeAction([6, 4, 3, 1]), { type: 'macro', index: 4, mode: 3, repeat: 1 }) // while held
})
