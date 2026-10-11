// Macro editing rules (format: docs/TECHNICAL.md). A macro is a list of steps; each step presses or releases a key
// and then waits `delay` ms before the next step (the hub's "interval"; it forces the last step's wait to 0).

import { REGIONS, type Macro, type MacroEvent } from './protocol.ts'

export const MACRO_SLOTS = 20 // the hub shows 20; slots 21–100 would be invisible there
export const WAIT = { min: 5, max: 65535, default: 20 } // ms; hub minimum 5
const POOL = REGIONS.macros.size - 400 // bytes after the 100 × 4-byte offset table
const bytes = (m: Macro) => (m ? 4 + 4 * m.length : 0)

/** Storage: bytes used and the total available for all macros. */
export const usage = (macros: Macro[]) => ({ used: macros.reduce((n, m) => n + bytes(m), 0), total: POOL })
export const fits = (macros: Macro[]) => usage(macros).used <= POOL

export const isPress = (e: MacroEvent) => !!(e.flags & 0x80)
export const keyEvent = (code: number, press: boolean, delay: number): MacroEvent => ({ delay, code, flags: press ? 0xb0 : 0x30 })
export const withPress = (e: MacroEvent, press: boolean): MacroEvent => ({ ...e, flags: (e.flags & 0x7f) | (press ? 0x80 : 0) })

/** Steps as saved: empty → null (slot unused), last step waits 0, other waits within the hub's limits. A step with no
 *  wait (the former last step, moved up) gets the default wait. */
export function normalize(steps: MacroEvent[]): Macro {
  if (!steps.length) return null
  return steps.map((e, i) => ({ ...e, delay: i === steps.length - 1 ? 0 : (!e.delay ? WAIT.default : Math.min(WAIT.max, Math.max(WAIT.min, Math.round(e.delay)))) }))
}

/** Keys the macro presses but never releases afterwards (they would stay held down). */
export function leftPressed(steps: MacroEvent[]): number[] {
  const down = new Set<number>()
  for (const e of steps) if (e.flags & 0x20) { if (isPress(e)) down.add(e.code); else down.delete(e.code) } // keyboard steps only
  return [...down]
}

// ---- Recording (step 11b): browser key events → macro steps ----------------------------------------------------

// KeyboardEvent.code → HID usage (USB HID usage tables, keyboard page). Layout-independent: "KeyA" is the key in the
// A position whatever the system layout, which is also what the keyboard sends.
const CODES: Record<string, number> = {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99, IntlBackslash: 100,
  ContextMenu: 101, ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229,
  AltRight: 230, MetaRight: 231,
}
export function usageOf(code: string): number | undefined {
  let m
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].charCodeAt(0) - 61 // A = 4
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1] === '0' ? 39 : Number(m[1]) + 29
  if ((m = /^Numpad([1-9])$/.exec(code))) return Number(m[1]) + 88
  if ((m = /^F([0-9]+)$/.exec(code))) { const n = Number(m[1]); return n <= 12 ? n + 57 : n <= 24 ? n + 91 : undefined }
  return CODES[code]
}

export interface Recorded { usage: number; press: boolean; time: number } // time in ms

/** Turns recorded presses/releases into steps: waits from the real timing, or `fixedWait` for every step. Keys still
 *  held at the end get a release, so a recording never leaves a key stuck down. */
export function fromRecording(events: Recorded[], fixedWait?: number): MacroEvent[] {
  const held = leftPressed(events.map(e => keyEvent(e.usage, e.press, 0)))
  const end = events.length ? events[events.length - 1].time : 0
  const all = [...events, ...held.map(usage => ({ usage, press: false, time: end }))]
  return all.map((e, i) => keyEvent(e.usage, e.press, i === all.length - 1 ? 0 : fixedWait ?? Math.round(all[i + 1].time - e.time)))
}
