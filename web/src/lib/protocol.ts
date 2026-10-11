// Typed decode/encode for HE80 regions. Layouts: docs/TECHNICAL.md §6 (DKS §6.5, macros §6.6).
// Every encoder is read-modify-write: it patches known fields into a copy of the raw bytes it was decoded from,
// so bytes we don't understand (e.g. settings bytes 6 and 15) are written back unchanged.

export const REGIONS = {
  info: { read: 0x10, size: 56 },
  settings: { read: 0x11, write: 0x21, size: 56 },
  keymap: { read: 0x12, write: 0x22, size: 512 },
  macros: { read: 0x15, write: 0x25, size: 1024 },
  fnLayer: { read: 0x16, write: 0x26, size: 512 },
  rt: { read: 0x17, write: 0x27, size: 1024 },
  dks: { read: 0x18, write: 0x28, size: 1024 },
} as const
export type RegionName = keyof typeof REGIONS

const le16 = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8)
const set16 = (d: Uint8Array, i: number, v: number) => { d[i] = v & 0xff; d[i + 1] = (v >> 8) & 0xff }
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((x, i) => x === b[i])

// ---- Device info (0x10) --------------------------------------------------------------------------------------

export const HE80_PRODUCTS = [4100, 4864, 4364]

export interface Info { vid: number; pid: number; firmware: string; productNum: number; known: boolean; rtPrecision: number }

export function decodeInfo(d: Uint8Array): Info {
  const productNum = le16(d, 14)
  return {
    vid: le16(d, 4),
    pid: le16(d, 6),
    firmware: (((d[8] & 15) + (d[8] >> 4) * 10 + d[9] * 100) / 100).toFixed(2),
    productNum,
    known: HE80_PRODUCTS.includes(productNum),
    rtPrecision: d[29],
  }
}

// ---- Settings (0x11 / 0x21) ----------------------------------------------------------------------------------

const RATES = { 3: 1000, 4: 2000, 5: 4000, 6: 8000 } as Record<number, number>

export const POLLING_RATES = [1000, 2000, 4000, 8000]

export interface Settings {
  pollingRate: number // Hz
  topDeadZone: number // 0.01 mm; not offered in the UI (no visible effect on firmware 1.08), only reset
  bottomDeadZone: number // 0.01 mm
  stability: boolean
  adaptiveCalibration: boolean
}

export function decodeSettings(d: Uint8Array): Settings {
  return { pollingRate: RATES[d[5]] ?? 0, topDeadZone: d[8], bottomDeadZone: d[9], stability: !!d[11], adaptiveCalibration: !!d[14] }
}

export function encodeSettings(raw: Uint8Array, s: Settings) {
  const code = Object.keys(RATES).map(Number).find(k => RATES[k] === s.pollingRate)
  if (code === undefined) throw new Error(`unsupported polling rate ${s.pollingRate}`)
  const d = raw.slice()
  d[5] = code
  d[8] = s.topDeadZone
  d[9] = s.bottomDeadZone
  d[11] = +s.stability
  d[14] = +s.adaptiveCalibration
  return d
}

// ---- Key map (0x12 / 0x22) and Fn layer (0x16 / 0x26): 128 × 4 bytes ------------------------------------------

export type KeyAction =
  | { type: 'default' }
  | { type: 'mouse'; kind: number; value: number } // kind 1 = button (mask), 3 = wheel (1 up, 255 down)
  | { type: 'key'; mods: number; usage: number }
  | { type: 'consumer'; usage: number }
  | { type: 'macro'; index: number; mode: number; repeat: number } // mode 0 once, 1 repeat, 2 until pressed again
  | { type: 'dks'; slot: number }
  | { type: 'mt'; hold: number; tap: number; time: number } // time in 10 ms units
  | { type: 'tgl'; usage: number }
  | { type: 'socd'; mode: number; key1: number; key2: number }
  | { type: 'rs'; key1: number; key2: number }
  | { type: 'fn'; id: number }
  | { type: 'raw'; bytes: number[] } // types we don't edit (system, combo, FUNC_V2, …), kept byte-exact

export function encodeAction(a: KeyAction): number[] {
  switch (a.type) {
    case 'default': return [0, 0, 0, 0]
    case 'mouse': return [1, a.kind, a.value, 0]
    case 'key': return [2, a.mods, a.usage, 0]
    case 'consumer': return [3, a.usage & 0xff, a.usage >> 8, 0]
    case 'macro': return [6, a.index, a.mode, a.repeat]
    case 'dks': return [8, a.slot, 0, 0]
    case 'mt': return [9, a.hold, a.tap, a.time]
    case 'tgl': return [10, a.usage, 0, 0]
    case 'socd': return [11, a.mode, a.key1, a.key2]
    case 'rs': return [12, 0, a.key1, a.key2]
    case 'fn': return [13, (a.id >> 16) & 0xff, (a.id >> 8) & 0xff, a.id & 0xff]
    case 'raw': return a.bytes
  }
}

function parseAction([t, a, b, c]: number[]): KeyAction {
  switch (t) {
    case 0: return { type: 'default' }
    case 1: return { type: 'mouse', kind: a, value: b }
    case 2: return { type: 'key', mods: a, usage: b }
    case 3: return { type: 'consumer', usage: a | (b << 8) }
    case 6: return { type: 'macro', index: a, mode: b, repeat: c }
    case 8: return { type: 'dks', slot: a }
    case 9: return { type: 'mt', hold: a, tap: b, time: c }
    case 10: return { type: 'tgl', usage: a }
    case 11: return { type: 'socd', mode: a, key1: b, key2: c }
    case 12: return { type: 'rs', key1: b, key2: c }
    case 13: return { type: 'fn', id: (a << 16) | (b << 8) | c }
    default: return { type: 'raw', bytes: [t, a, b, c] }
  }
}

/** Decodes one 4-byte entry. Anything that wouldn't re-encode identically comes back as 'raw'. */
export function decodeAction(bytes: ArrayLike<number>): KeyAction {
  const b = Array.from(bytes)
  const a = parseAction(b)
  return same(encodeAction(a), b) ? a : { type: 'raw', bytes: b }
}

// Advanced keys (hub limits for the HE80): at most 40 per key map; tap/hold time 10–1000 ms, stored in 10 ms steps.
export const ADVANCED_MAX = 40
export const MT_TIME = { min: 10, max: 1000, default: 200 }

export const decodeKeymap = (d: Uint8Array) => Array.from({ length: 128 }, (_, k) => decodeAction(d.subarray(4 * k, 4 * k + 4)))

export function encodeKeymap(raw: Uint8Array, actions: KeyAction[]) {
  const d = raw.slice()
  actions.forEach((a, k) => d.set(encodeAction(a), 4 * k))
  return d
}

// ---- Per-key RT / actuation (0x17 / 0x27): 128 × 8 bytes, all distances in 0.01 mm -----------------------------

export interface KeyTravel {
  switchType: number
  flags: number // raw byte; bit0 = full-travel RT, bits 1–2 unresolved, kept as-is
  actuation: number
  press: number // RT press sensitivity, 0 = RT off
  release: number // RT release sensitivity
}

export const fullTravel = (t: KeyTravel) => !!(t.flags & 1)
export const withFullTravel = (t: KeyTravel, on: boolean): KeyTravel => ({ ...t, flags: (t.flags & ~1) | +on })

// HE80 limits, 0.01 mm (docs/TECHNICAL.md). RT minimum 0.02 as in the official driver, which warns at 0.04 or less.
// Default = what unused slots read: 1.20 mm, RT off.
export const TRAVEL = { actuation: { min: 10, max: 330 }, rt: { min: 2, max: 330 }, rtWarn: 4, defaultActuation: 120, defaultRt: 10 }

/** Factory default for a key: 1.20 mm, RT off, full-travel off. Switch type and flag bits 1–2 are kept. */
export const resetTravel = (t: KeyTravel): KeyTravel =>
  withFullTravel({ ...t, actuation: TRAVEL.defaultActuation, press: 0, release: 0 }, false)

/** Clamps a value (0.01 mm) into a limit range; NaN falls back to the minimum. */
export const clamp = (v: number, { min, max }: { min: number; max: number }) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : min

export const decodeRt = (d: Uint8Array): KeyTravel[] => Array.from({ length: 128 }, (_, k) => {
  const o = 8 * k
  return { switchType: d[o], flags: d[o + 1], actuation: le16(d, o + 2), press: le16(d, o + 4), release: le16(d, o + 6) }
})

export function encodeRt(raw: Uint8Array, keys: KeyTravel[]) {
  const d = raw.slice()
  keys.forEach((t, k) => {
    const o = 8 * k
    d[o] = t.switchType
    d[o + 1] = t.flags
    set16(d, o + 2, t.actuation)
    set16(d, o + 4, t.press)
    set16(d, o + 6, t.release)
  })
  return d
}

// ---- DKS slots (0x18 / 0x28): 64 × 16 bytes -------------------------------------------------------------------

export interface DksSlot {
  points: number[] // 4 stage points, 0.1 mm
  keys: number[] // 4 bound HID usages (0 = none)
  masks: number[] // per stage: bit n = key n tap, bit n+4 = key n held through the stage
}

export const decodeDks = (d: Uint8Array): (DksSlot | null)[] => Array.from({ length: 64 }, (_, s) => {
  const b = d.subarray(16 * s, 16 * s + 16)
  if (b.every(x => x === 0)) return null
  return { points: Array.from(b.subarray(0, 4)), keys: [b[5], b[7], b[9], b[11]], masks: Array.from(b.subarray(12, 16)) }
})

// HE80 DKS travel (hub: 0.1–3.0 mm in 0.1 steps), 0.1 mm. New slots use the hub defaults: start 1.6, bottom 3.0.
export const DKS_TRAVEL = { min: 1, max: 30, start: 16, bottom: 30 }

/** Per key and stage (0 press, 1 bottom, 2 lift from bottom, 3 release): 0 nothing, 1 tap, 2 held. A run of 2s holds
 *  the key from its first stage until the stage after the run (hub DksActionGrid). */
export type DksState = 0 | 1 | 2
export const dksState = (s: DksSlot, key: number, stage: number): DksState =>
  (s.masks[stage] >> key) & 1 ? 1 : (s.masks[stage] >> (key + 4)) & 1 ? 2 : 0
export const withDksState = (s: DksSlot, key: number, stage: number, v: DksState): DksSlot => ({
  ...s,
  masks: s.masks.map((m, i) => (i !== stage ? m : (m & ~(0x11 << key)) | (v === 1 ? 1 << key : v === 2 ? 0x10 << key : 0))),
})

/** Holds `key` from stage `from` and releases it at stage `to` (from < to ≤ 3): stages from…to−1 become 2. A tap on
 *  the release stage is kept. */
export function setDksHold(s: DksSlot, key: number, from: number, to: number): DksSlot {
  for (let n = from; n < to; n++) s = withDksState(s, key, n, 2)
  return s
}

/** Removes the whole hold that stage `stage` belongs to (a run of 2s), or toggles a tap there if it isn't held. */
export function toggleDksCell(s: DksSlot, key: number, stage: number): DksSlot {
  if (dksState(s, key, stage) !== 2) return withDksState(s, key, stage, dksState(s, key, stage) ? 0 : 1)
  let a = stage, b = stage
  while (a > 0 && dksState(s, key, a - 1) === 2) a--
  while (b < 3 && dksState(s, key, b + 1) === 2) b++
  for (let n = a; n <= b; n++) s = withDksState(s, key, n, 0)
  return s
}

/** A new slot that behaves like a plain key: `usage` held from press to release. */
export const newDksSlot = (usage: number): DksSlot => ({
  points: [DKS_TRAVEL.start, DKS_TRAVEL.bottom, DKS_TRAVEL.bottom, DKS_TRAVEL.start],
  keys: [usage, 0, 0, 0],
  masks: [0x10, 0x10, 0x10, 0],
})

/** First slot no key points at and that holds nothing (hub: firstFreeSlot), or -1. */
export function freeDksSlot(keymap: KeyAction[], slots: (DksSlot | null)[]) {
  const used = new Set(keymap.flatMap(a => (a.type === 'dks' ? [a.slot] : [])))
  return slots.findIndex((s, i) => !s && !used.has(i))
}

export function encodeDks(raw: Uint8Array, slots: (DksSlot | null)[]) {
  const d = raw.slice()
  slots.forEach((s, i) => {
    const o = 16 * i
    if (!s) return d.fill(0, o, o + 16)
    d.set(s.points, o)
    s.keys.forEach((u, n) => { d[o + 4 + 2 * n] = 0; d[o + 5 + 2 * n] = u })
    d.set(s.masks, o + 12)
  })
  return d
}

// ---- Macros (0x15 / 0x25): 100 × LE32 offset table, then packed macros ------------------------------------------

export interface MacroEvent { delay: number; code: number; flags: number } // flags 0xB0 key down, 0x30 key up, 0x90/0x10 mouse
export type Macro = MacroEvent[] | null

const TABLE = 400

export function decodeMacros(d: Uint8Array): Macro[] {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  return Array.from({ length: 100 }, (_, i) => {
    const off = v.getUint32(4 * i, true)
    if (!off) return null
    const count = v.getUint16(off, true) / 2
    return Array.from({ length: count }, (_, e) => {
      const o = off + 4 + 4 * e
      return { delay: v.getUint16(o, true), code: d[o + 2], flags: d[o + 3] }
    })
  })
}

/** Rebuilds the whole region (macros packed from byte 400, like the official driver). */
export function encodeMacros(macros: Macro[]): Uint8Array {
  const d = new Uint8Array(REGIONS.macros.size)
  const v = new DataView(d.buffer)
  let off = TABLE
  macros.forEach((m, i) => {
    if (!m) return
    if (off + 4 + 4 * m.length > d.length) throw new Error('macros do not fit in 1024 bytes')
    v.setUint32(4 * i, off, true)
    v.setUint16(off, m.length * 2, true)
    m.forEach((e, n) => {
      const o = off + 4 + 4 * n
      v.setUint16(o, e.delay, true)
      d[o + 2] = e.code
      d[o + 3] = e.flags
    })
    off += 4 + 4 * m.length
  })
  return d
}
