// Human-readable names for key actions (docs/TECHNICAL.md). Short = fits on a keycap, long = for the inspector.

import { usageName } from './keys.ts'
import type { KeyAction } from './protocol.ts'

export const CONSUMER: Record<number, string> = {
  404: 'My Computer', 402: 'Calculator', 394: 'Email', 387: 'Media', 205: 'Play / Pause', 183: 'Stop', 182: 'Previous',
  181: 'Next', 233: 'Volume up', 234: 'Volume down', 226: 'Mute', 547: 'Browser home', 551: 'Refresh', 549: 'Forward',
  548: 'Back', 554: 'Favorites', 545: 'Search',
}
export const FN: Record<number, string> = {
  1: 'Factory reset', 8: 'Windows mode', 9: 'Mac mode', 11: 'Next light effect', 12: 'Next light color', 13: 'Brightness up',
  14: 'Brightness down', 15: 'Light speed up', 16: 'Light speed down', 17: 'Lights off', 18: 'Alt+Tab', 19: 'Win+E',
  20: 'Win+Tab', 21: 'Win+H', 22: 'Win lock', 23: 'Side light effect', 24: 'Side light color', 30: 'Ctrl+Up',
  32: 'Lighting direction', 33: 'Alt+Esc',
}
export const MOUSE_BUTTONS: Record<number, string> = { 1: 'Left click', 2: 'Right click', 4: 'Middle click', 8: 'Back', 16: 'Forward' }
const MODS = ['Ctrl', 'Shift', 'Alt', 'Win', 'RCtrl', 'RShift', 'RAlt', 'RWin']
// Macro play modes as the hub writes them: 1 = play `repeat` times (the hub's "once" is 1 × 1), 2 = until pressed
// again, 3 = while held. 0 (play once) is never written by the hub but may be read.
const MACRO_PLAY: Record<number, (n: number) => string> = {
  0: () => '', 1: n => (n > 1 ? `, ${n} times` : ''), 2: () => ', until pressed again', 3: () => ', while held',
}
const SOCD = { 1: 'first key wins', 2: 'second key wins', 3: 'last input wins', 4: 'neutral' } as Record<number, string>

const mods = (m: number) => MODS.filter((_, i) => m & (1 << i)).map(s => s + '+').join('')

export function describeAction(a: KeyAction): { short: string; long: string } {
  switch (a.type) {
    case 'default': return { short: '', long: 'Default' }
    case 'key': return { short: mods(a.mods) + usageName(a.usage), long: `Key ${mods(a.mods)}${usageName(a.usage)}` }
    case 'consumer': return { short: CONSUMER[a.usage] ?? 'Media', long: `Media: ${CONSUMER[a.usage] ?? 'usage ' + a.usage}` }
    case 'mouse': {
      const what = a.kind === 3 ? (a.value === 1 ? 'Wheel up' : 'Wheel down') : (MOUSE_BUTTONS[a.value] ?? `button ${a.value}`)
      return { short: what, long: `Mouse: ${what}` }
    }
    case 'macro': return { short: `M${a.index + 1}`, long: `Macro ${a.index + 1}${MACRO_PLAY[a.mode]?.(a.repeat) ?? ''}` }
    case 'dks': return { short: 'DKS', long: `Dynamic keystroke, slot ${a.slot + 1}` }
    case 'mt': return { short: `${usageName(a.tap)} / ${usageName(a.hold)}`, long: `Tap ${usageName(a.tap)}, hold ${usageName(a.hold)} (${a.time * 10} ms)` }
    case 'tgl': return { short: `Toggle ${usageName(a.usage)}`, long: `Toggle ${usageName(a.usage)}` }
    case 'socd': return { short: 'SOCD', long: `SOCD ${usageName(a.key1)} / ${usageName(a.key2)}, ${SOCD[a.mode] ?? 'mode ' + a.mode}` }
    case 'rs': return { short: 'RS', long: `Snap tap ${usageName(a.key1)} / ${usageName(a.key2)}` }
    case 'fn': return { short: FN[a.id] ?? `Fn ${a.id}`, long: FN[a.id] ?? `Keyboard function ${a.id}` }
    case 'raw': return { short: '?', long: `Unknown entry ${a.bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}` }
  }
}

export const isAdvanced = (a: KeyAction) => ['dks', 'mt', 'tgl', 'socd', 'rs'].includes(a.type)

/** 0.01 mm units → "0.10". */
export const mm = (v: number) => (v / 100).toFixed(2)
