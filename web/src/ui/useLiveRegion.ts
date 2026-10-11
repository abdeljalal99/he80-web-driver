// Live editing: edits show on screen at once and are saved to the keyboard automatically a moment later.
// `useLive` works on any value (e.g. key map + DKS slots together); `useLiveRegion` is the per-key-region version
// used by the RT, Fn layer and settings editors.

import { useState } from 'react'
import type { WritableRegion } from '../lib/backup.ts'
import { createSaver, type SaveState } from '../lib/saver.ts'

type Write = (name: WritableRegion, makeAfter: (before: Uint8Array) => Uint8Array) => Promise<void>

export function useLive<V>(
  saved: V | undefined, // decoded value the keyboard holds
  save: (v: V) => Promise<void>,
  report: (s: SaveState) => void,
) {
  // Value not yet on the keyboard (what the screen shows meanwhile).
  const [pending, setPending] = useState<V | null>(null)
  // One saver per editor (useState's initializer runs once). ponytail: 400 ms debounce, tune if saving feels slow.
  const [saver] = useState(() => {
    const sv = createSaver<V>(save, 400, st => {
      if (st !== 'saving' && sv.pending === null) setPending(null) // nothing newer waiting: show the keyboard's value
      report(st)
    })
    return sv
  })

  return {
    value: pending ?? saved,
    /** Replaces the value with `change(current)` and schedules a save. */
    edit(change: (v: V) => V) {
      const base = saver.pending ?? pending ?? saved
      if (base === undefined || base === null) return
      const next = change(base)
      setPending(next)
      saver.push(next)
    },
  }
}

export function useLiveRegion<T>(
  name: WritableRegion,
  saved: T[] | undefined,
  encode: (before: Uint8Array, values: T[]) => Uint8Array,
  write: Write,
  report: (s: SaveState) => void,
) {
  const live = useLive<T[]>(saved, values => write(name, before => encode(before, values)), report)
  return {
    values: live.value,
    /** Applies `change` to every index in `targets` and schedules a save. */
    edit: (targets: Set<number>, change: (v: T, index: number) => T) =>
      live.edit(base => base.map((v, i) => (targets.has(i) ? change(v, i) : v))),
  }
}
