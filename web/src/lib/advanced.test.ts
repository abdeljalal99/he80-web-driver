import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partnerOf, saveBoard, tidy, type Board } from './advanced.ts'
import { decodeDks, decodeKeymap, encodeDks, encodeKeymap, newDksSlot, type KeyAction } from './protocol.ts'

const A = 49, D = 51, W = 34 // key indices
const empty = (): Board => ({ keymap: Array.from({ length: 128 }, (): KeyAction => ({ type: 'default' })), dks: Array(64).fill(null) })
const socdAD = (mode = 3): KeyAction => ({ type: 'socd', mode, key1: 4, key2: 7 })
const edit = (b: Board, f: (km: KeyAction[]) => void) => { const km = b.keymap.slice(); f(km); return tidy(b, { ...b, keymap: km }) }

test('SOCD / Rapid Switch partner lookup', () => {
  const b = empty()
  b.keymap[A] = b.keymap[D] = socdAD()
  assert.equal(partnerOf(b.keymap, A), D)
  assert.equal(partnerOf(b.keymap, D), A)
  b.keymap[D] = { type: 'default' } // broken pair
  assert.equal(partnerOf(b.keymap, A), undefined)
  assert.equal(partnerOf(b.keymap, 0), undefined)
})

test('tidy: partners follow mode changes and are cleared when the pair breaks', () => {
  const b = empty()
  b.keymap[A] = b.keymap[D] = socdAD()
  assert.deepEqual(edit(b, km => { km[A] = socdAD(4) }).keymap[D], socdAD(4)) // mode change on one key
  assert.deepEqual(edit(b, km => { km[A] = { type: 'key', mods: 0, usage: 5 } }).keymap[D], { type: 'default' }) // Key map tab remap
  const aw: KeyAction = { type: 'socd', mode: 3, key1: 4, key2: 26 }
  const re = edit(b, km => { km[A] = km[W] = aw }) // A re-paired with W
  assert.deepEqual([re.keymap[A], re.keymap[W], re.keymap[D]], [aw, aw, { type: 'default' }])
})

test('tidy: DKS slots no key points at any more are emptied', () => {
  const b = empty()
  b.keymap[A] = { type: 'dks', slot: 2 }
  b.dks[2] = newDksSlot(4)
  assert.equal(edit(b, km => { km[A] = { type: 'default' } }).dks[2], null)
  assert.ok(edit(b, km => { km[D] = { type: 'tgl', usage: 7 } }).dks[2]) // unrelated edit keeps it
})

// Fake keyboard: records each region write and checks after every one that no key points at an empty slot.
function fakeWrite(board: Board, failOn = -1) {
  const regs: Record<'keymap' | 'dks', Uint8Array> = { keymap: encodeKeymap(new Uint8Array(512), board.keymap), dks: encodeDks(new Uint8Array(1024), board.dks) }
  const log: string[] = []
  const write = async (name: 'keymap' | 'dks', makeAfter: (b: Uint8Array) => Uint8Array) => {
    if (log.length === failOn) throw new Error('write failed')
    regs[name] = makeAfter(regs[name])
    log.push(name)
    const slots = decodeDks(regs.dks)
    for (const a of decodeKeymap(regs.keymap)) if (a.type === 'dks') assert.ok(slots[a.slot], `key points at empty slot ${a.slot}`)
  }
  return { write, log, regs }
}

test('saveBoard: slot before key on assign, key before clearing on remove, safe if a step fails', async () => {
  const before = empty()
  const added = { keymap: before.keymap.slice(), dks: before.dks.slice() }
  added.keymap[A] = { type: 'dks', slot: 0 }
  added.dks[0] = newDksSlot(4)
  const f = fakeWrite(before)
  await saveBoard(f.write, added)
  assert.deepEqual(decodeDks(f.regs.dks)[0], newDksSlot(4))

  const removed = tidy(added, { ...added, keymap: added.keymap.map((a, i) => (i === A ? { type: 'default' } : a)) })
  for (const failOn of [0, 1, 2, -1]) await saveBoard(fakeWrite(added, failOn).write, removed).catch(e => assert.equal(e.message, 'write failed')) // asserts inside
  const g = fakeWrite(added)
  await saveBoard(g.write, removed)
  assert.equal(decodeDks(g.regs.dks)[0], null)
})
