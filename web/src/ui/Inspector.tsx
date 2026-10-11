// Shared panel pieces: row, heading for the selected keys, empty-selection hint.

import { KEYS } from '../lib/keys.ts'

const labelOf = (i: number) => KEYS.find(k => k.index === i)?.label ?? `#${i}`

export function Row({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5 last:border-0">
      <dt className="text-mute">{name}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

export function Heading({ selected }: { selected: number[] }) {
  const names = selected.map(labelOf)
  return (
    <h2 className="mb-2 text-lg font-semibold">
      {names.length === 0 ? 'No keys selected' : names.length === 1 ? names[0] : `${names.length} keys`}
      {names.length > 1 && names.length <= 6 && <span className="ml-2 font-normal text-mute">{names.join(', ')}</span>}
    </h2>
  )
}

export function Empty() {
  return (
    <p className="text-mute">
      Select keys on the keyboard to change their actuation and rapid trigger.
    </p>
  )
}
