// Key map + DKS slots as one unit ("board"), with the rules that span several keys. Every key map edit, from any tab,
// goes through `tidy`, and every save through `saveBoard`, so no editor can break a pair or strand a DKS slot.

import { KEYS } from './keys.ts'
import { decodeDks, encodeDks, encodeKeymap, type DksSlot, type KeyAction } from './protocol.ts'

export interface Board { keymap: KeyAction[]; dks: (DksSlot | null)[] }

const sameAction = (a: KeyAction, b: KeyAction) => JSON.stringify(a) === JSON.stringify(b)

/** SOCD / Rapid Switch pairs hold the same entry on both keys (key1/key2 = the keys' own usages). Returns the other
 *  key's index, or undefined if `i` isn't paired or its partner no longer holds the same entry. */
export function partnerOf(keymap: KeyAction[], i: number): number | undefined {
  const a = keymap[i]
  if (a.type !== 'socd' && a.type !== 'rs') return undefined
  const own = KEYS.find(k => k.index === i)?.usage
  const other = a.key1 === own ? a.key2 : a.key1
  return KEYS.find(k => k.index !== i && k.usage === other && sameAction(keymap[k.index], a))?.index
}

/**
 * Applies the cross-key rules to an edit (`before` → `after`):
 * - a pair key that changed takes its untouched partner along: same pair (e.g. new SOCD mode) → the partner gets the
 *   same entry; anything else → the partner goes back to default, so no half pair is left behind;
 * - DKS slots that keys pointed at before but none points at now are emptied.
 */
export function tidy(before: Board, after: Board): Board {
  const keymap = after.keymap.slice()
  before.keymap.forEach((old, i) => {
    const now = after.keymap[i]
    if (sameAction(old, now)) return
    const p = partnerOf(before.keymap, i)
    if (p === undefined || !sameAction(after.keymap[p], before.keymap[p])) return
    const samePair = now.type === old.type && (now.type === 'socd' || now.type === 'rs') && (old.type === 'socd' || old.type === 'rs')
      && now.key1 === old.key1 && now.key2 === old.key2
    keymap[p] = samePair ? now : { type: 'default' }
  })
  const used = (km: KeyAction[]) => new Set(km.flatMap(a => (a.type === 'dks' ? [a.slot] : [])))
  const was = used(before.keymap), is = used(keymap)
  const dks = after.dks.map((s, i) => (was.has(i) && !is.has(i) ? null : s))
  return { keymap, dks }
}

type Write = (name: 'keymap' | 'dks', makeAfter: (before: Uint8Array) => Uint8Array) => Promise<void>

/**
 * Saves a board in an order that never leaves a key pointing at an empty DKS slot, even if a step fails:
 * 1. new / changed slots (slots being emptied keep their old content for now), 2. the key map, 3. empty unused slots.
 * Steps that change nothing are skipped by `write`.
 */
export async function saveBoard(write: Write, b: Board) {
  await write('dks', before => {
    const old = decodeDks(before)
    return encodeDks(before, b.dks.map((s, i) => s ?? old[i]))
  })
  await write('keymap', before => encodeKeymap(before, b.keymap))
  await write('dks', before => encodeDks(before, b.dks))
}
