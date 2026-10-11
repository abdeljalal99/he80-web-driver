// What a key can be remapped to, grouped for the picker (key map types 1–3 from docs/TECHNICAL.md).

import { CONSUMER, MOUSE_BUTTONS } from './describe.ts'
import { usageName } from './keys.ts'
import type { KeyAction } from './protocol.ts'

export interface Choice { label: string; action: KeyAction }
export interface Group { name: string; choices: Choice[] }

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const keys = (usages: number[]): Choice[] => usages.map(u => ({ label: usageName(u), action: { type: 'key', mods: 0, usage: u } }))

export const GROUPS: Group[] = [
  { name: 'Letters', choices: keys(range(4, 29)) },
  { name: 'Numbers', choices: keys(range(30, 39)) },
  { name: 'Function keys', choices: keys([...range(58, 69), ...range(104, 115)]) },
  { name: 'Symbols', choices: keys([53, 45, 46, 47, 48, 49, 51, 52, 54, 55, 56]) },
  { name: 'Editing and navigation', choices: keys([41, 43, 57, 42, 40, 44, 73, 76, 74, 77, 75, 78, 82, 81, 80, 79, 70, 71, 72, 101]) },
  { name: 'Modifiers', choices: keys(range(224, 231)) },
  { name: 'Numpad', choices: keys([83, 84, 85, 86, 87, 88, ...range(89, 99)]) },
  {
    name: 'Media',
    choices: Object.entries(CONSUMER).map(([u, label]) => ({ label, action: { type: 'consumer', usage: Number(u) } })),
  },
  {
    name: 'Mouse',
    choices: [
      ...Object.entries(MOUSE_BUTTONS).map(([v, label]) => ({ label, action: { type: 'mouse', kind: 1, value: Number(v) } as KeyAction })),
      { label: 'Wheel up', action: { type: 'mouse', kind: 3, value: 1 } },
      { label: 'Wheel down', action: { type: 'mouse', kind: 3, value: 255 } },
    ],
  },
]

