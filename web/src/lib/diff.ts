// Human-readable differences between two sets of regions (keyboard now vs. a backup), for the restore preview.

import { WRITES } from './hid.ts'
import { KEYS } from './keys.ts'
import { describeAction, mm } from './describe.ts'
import { REGIONS, decodeDks, decodeKeymap, decodeMacros, decodeRt, decodeSettings, fullTravel, type KeyTravel } from './protocol.ts'
import type { Regions, WritableRegion } from './backup.ts'

export interface DiffGroup {
  region: WritableRegion
  title: string
  allowed: boolean // its write command is enabled (hardware-tested); otherwise it can't be restored yet
  lines: string[]
}

const TITLES: Record<WritableRegion, string> = {
  rt: 'Actuation & rapid trigger', keymap: 'Key map', settings: 'Settings', fnLayer: 'Fn layer', dks: 'Dynamic keystrokes', macros: 'Macros',
}
const ORDER: WritableRegion[] = ['rt', 'keymap', 'settings', 'fnLayer', 'dks', 'macros']

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])
const rtText = (t: KeyTravel) => (t.press ? (t.press === t.release ? mm(t.press) : `${mm(t.press)} / ${mm(t.release)}`) : 'off')
const actionText = (a: Parameters<typeof describeAction>[0]) => (a.type === 'default' ? 'original key' : describeAction(a).long.replace(/^Key /, ''))

function travelChanges(from: KeyTravel, to: KeyTravel) {
  const out: string[] = []
  if (from.actuation !== to.actuation) out.push(`actuation ${mm(from.actuation)} → ${mm(to.actuation)} mm`)
  if (from.press !== to.press || from.release !== to.release) out.push(`rapid trigger ${rtText(from)} → ${rtText(to)}`)
  if (fullTravel(from) !== fullTravel(to)) out.push(`full-travel ${fullTravel(from) ? 'on' : 'off'} → ${fullTravel(to) ? 'on' : 'off'}`)
  if (!out.length) out.push('internal flags') // switch type or unresolved flag bits
  return out.join(', ')
}

// Keys getting the same change share one line: "All 82 keys: …", "W, A, S, D: …", "Esc, F1, F2 and 12 more: …".
function grouped(changes: { label: string; text: string }[]) {
  const byText = new Map<string, string[]>()
  for (const c of changes) byText.set(c.text, [...(byText.get(c.text) ?? []), c.label])
  return [...byText].map(([text, labels]) => {
    const who = labels.length === KEYS.length ? `All ${labels.length} keys`
      : labels.length > 6 ? `${labels.slice(0, 3).join(', ')} and ${labels.length - 3} more`
      : labels.join(', ')
    return `${who}: ${text}`
  })
}

function linesFor(region: WritableRegion, now: Uint8Array, want: Uint8Array): string[] {
  switch (region) {
    case 'rt': {
      const a = decodeRt(now), b = decodeRt(want)
      return grouped(KEYS.filter(k => !equal(now.subarray(8 * k.index, 8 * k.index + 8), want.subarray(8 * k.index, 8 * k.index + 8)))
        .map(k => ({ label: k.label, text: travelChanges(a[k.index], b[k.index]) })))
    }
    case 'keymap':
    case 'fnLayer': {
      const a = decodeKeymap(now), b = decodeKeymap(want)
      return grouped(KEYS.filter(k => !equal(now.subarray(4 * k.index, 4 * k.index + 4), want.subarray(4 * k.index, 4 * k.index + 4)))
        .map(k => ({ label: k.label, text: `${actionText(a[k.index])} → ${actionText(b[k.index])}` })))
    }
    case 'settings': {
      const a = decodeSettings(now), b = decodeSettings(want)
      const onOff = (v: boolean) => (v ? 'on' : 'off')
      const out: string[] = []
      if (a.pollingRate !== b.pollingRate) out.push(`Polling rate ${a.pollingRate} → ${b.pollingRate} Hz`)
      if (a.topDeadZone !== b.topDeadZone) out.push(`Top dead zone ${mm(a.topDeadZone)} → ${mm(b.topDeadZone)} mm`)
      if (a.bottomDeadZone !== b.bottomDeadZone) out.push(`Bottom dead zone ${mm(a.bottomDeadZone)} → ${mm(b.bottomDeadZone)} mm`)
      if (a.stability !== b.stability) out.push(`Stability mode ${onOff(a.stability)} → ${onOff(b.stability)}`)
      if (a.adaptiveCalibration !== b.adaptiveCalibration) out.push(`Adaptive calibration ${onOff(a.adaptiveCalibration)} → ${onOff(b.adaptiveCalibration)}`)
      if (!out.length) out.push('Other settings bytes')
      return out
    }
    case 'dks': {
      const a = decodeDks(now), b = decodeDks(want)
      return a.flatMap((s, i) => (equal(now.subarray(16 * i, 16 * i + 16), want.subarray(16 * i, 16 * i + 16))
        ? [] : [`Slot ${i + 1}: ${s ? 'in use' : 'empty'} → ${b[i] ? 'in use' : 'empty'}`]))
    }
    case 'macros': {
      const a = decodeMacros(now), b = decodeMacros(want)
      const out = a.flatMap((m, i) => (JSON.stringify(m) === JSON.stringify(b[i])
        ? [] : [`Macro ${i + 1}: ${m ? `${m.length} events` : 'empty'} → ${b[i] ? `${b[i]!.length} events` : 'empty'}`]))
      return out.length ? out : ['Macro storage layout']
    }
  }
}

/** Every region that differs between `now` and `want`, with one line per changed key / field / slot. */
export function diffRegions(now: Regions, want: Regions): DiffGroup[] {
  return ORDER.flatMap(region => {
    const a = now[region], b = want[region]
    if (!a || !b || equal(a, b)) return []
    return [{ region, title: TITLES[region], allowed: WRITES.has(REGIONS[region].write), lines: linesFor(region, a, b) }]
  })
}
