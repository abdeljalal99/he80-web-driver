// Key map / Fn layer editor: pick what the selected keys send. Saved to the keyboard automatically (useLiveRegion in
// App). The Fn layer is what a key does while Fn is held; "default" there means the keyboard's own Fn function.

import { useId, useRef, useState } from 'react'
import { GROUPS } from '../lib/choices.ts'
import { describeAction } from '../lib/describe.ts'
import { usageName } from '../lib/keys.ts'
import { encodeAction, type KeyAction, type Macro } from '../lib/protocol.ts'
import { Heading } from './Inspector.tsx'
import { FN_BUILT_IN, FN_FIXED } from '../lib/fnDefaults.ts'

// Left-hand modifier bits of the key entry's mods byte (docs/TECHNICAL.md, type 2).
const MOD_BITS: [number, string][] = [[1, 'Ctrl'], [2, 'Shift'], [4, 'Alt'], [8, 'Win']]

export const FN_KEY = 85 // never remappable: without it the Fn layer (and its shortcuts) is unreachable

const same = (a: KeyAction, b: KeyAction) => encodeAction(a).join() === encodeAction(b).join()

export function KeyPicker({ layer, selected, keymap, other, macros, pick, locked }: {
  layer: 'base' | 'fn'
  macros?: Macro[] // created macros are offered in their own group (step 11c); base layer only: firmware 1.08
  // doesn't play macros from the Fn layer (tested 2026-10-11)
  selected: number[]
  keymap: KeyAction[] // the layer being edited
  other: KeyAction[] // the other layer, shown for reference
  pick: (a: KeyAction) => void // assigns to every selected key except Fn
  locked?: string
}) {
  const fnLayer = layer === 'fn'
  const defaultLabel = fnLayer ? 'Keyboard default' : 'Original key'
  const [query, setQuery] = useState('')
  // F1–F12 keep their built-in media functions in the Fn layer (the official hub doesn't allow changing them either).
  const targets = selected.filter(i => i !== FN_KEY && !(fnLayer && FN_FIXED.has(i)))
  const fixedPicked = fnLayer && selected.some(i => FN_FIXED.has(i))
  const current = targets.map(i => keymap[i])
  const shared = current.length && current.every(a => same(a, current[0])) ? current[0] : null
  const btn = 'rounded-md border px-1.5 py-1 text-xs font-medium leading-tight hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'

  return (
    <fieldset disabled={!!locked} className="grid min-w-0 gap-3">
      <Heading selected={selected} />
      {locked && <p className="-mt-2 text-sm text-mute">{locked}</p>}
      {!selected.length && (
        <p className="-mt-2 text-sm text-mute">
          {fnLayer ? 'Click keys on the keyboard to choose what they do while Fn is held.' : 'Click keys on the keyboard to choose which ones to remap.'}
        </p>
      )}
      {fixedPicked && <p className="-mt-2 text-sm text-mute">F1–F12 keep their built-in media functions with Fn; the keyboard doesn’t allow changing them.</p>}
      {selected.includes(FN_KEY) && <p className="-mt-2 text-sm text-mute">The Fn key can’t be remapped, so it’s left as it is.</p>}

      {targets.length > 0 && (
        <p className="text-sm">
          <span className="text-mute">{fnLayer ? 'With Fn sends ' : 'Sends '}</span>
          {!shared ? 'different things'
            : shared.type === 'default' && fnLayer
              ? (targets.length === 1 && FN_BUILT_IN[targets[0]] ? `${FN_BUILT_IN[targets[0]].long} (built in)` : 'nothing (no built-in function)')
              : describeAction(shared).long.replace(/^Key /, '')}
          {targets.length === 1 && other[targets[0]].type !== 'default' && (
            <span className="block text-xs text-mute">{fnLayer ? 'Without Fn' : 'With Fn'}: {describeAction(other[targets[0]]).long}</span>
          )}
        </p>
      )}

      {/* Shortcut on one key: modifier bits on a key mapping, [2, mods, key] (hidden in the hub; step 10d test). */}
      <div className="flex items-center gap-1.5">
        <span className="mr-1 text-xs font-semibold text-mute">Hold with it</span>
        {MOD_BITS.map(([bit, name]) => {
          const on = shared?.type === 'key' && !!(shared.mods & bit)
          return (
            <button key={name} type="button" aria-pressed={on} disabled={shared?.type !== 'key'}
              title={shared?.type === 'key' ? `Send ${name} together with the key` : 'Pick a key first'}
              onClick={() => shared?.type === 'key' && pick({ ...shared, mods: shared.mods ^ bit })}
              className={`${btn} px-2.5 ${on ? 'border-select bg-cap' : 'border-line'}`}>
              {name}
            </button>
          )
        })}
      </div>

      {shared?.type === 'macro' && <MacroPlay value={shared} onChange={pick} />}

      <div className="flex gap-2">
        <button type="button" disabled={!targets.length} onClick={() => pick({ type: 'default' })}
          className={`${btn} px-3 text-sm ${shared?.type === 'default' ? 'border-select bg-cap' : 'border-line'}`}>
          {defaultLabel}
        </button>
        <input type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search keys"
          aria-label="Search keys"
          className="min-w-0 flex-1 rounded-md border border-line bg-cap px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ink" />
      </div>

      {macros && (!query.trim() || 'macros'.includes(query.trim().toLowerCase())) && (
        <section>
          <h3 className="mb-1 text-xs font-semibold text-mute">Macros</h3>
          {macros.some(Boolean) ? (
            <div className="grid grid-cols-4 gap-1">
              {macros.flatMap((m, i) => (m ? [i] : [])).map(i => {
                const on = shared?.type === 'macro' && shared.index === i
                return (
                  <button key={i} type="button" aria-pressed={on} disabled={!targets.length}
                    onClick={() => pick(shared?.type === 'macro' ? { ...shared, index: i } : { type: 'macro', index: i, mode: 1, repeat: 1 })}
                    className={`${btn} ${on ? 'border-select bg-cap' : 'border-line'}`}>
                    Macro {i + 1}
                  </button>
                )
              })}
            </div>
          ) : <p className="text-xs text-mute">No macros yet. Make one on the Macros tab.</p>}
        </section>
      )}
      <ChoiceGroups query={query} disabled={!targets.length}
        isOn={a => shared !== null && (same(shared, a) || (shared.type === 'key' && a.type === 'key' && shared.usage === a.usage))}
        onPick={a => pick(a.type === 'key' && shared?.type === 'key' ? { ...a, mods: shared.mods } : a)} />
    </fieldset>
  )
}

/** The picker's grouped buttons, filtered by `query`. `keysOnly` limits it to keyboard keys (no media / mouse).
 *  Shared with the Advanced tab's key choices. */
export function ChoiceGroups({ query, keysOnly, disabled, isOn, onPick }: {
  query: string
  keysOnly?: boolean
  disabled?: boolean
  isOn: (a: KeyAction) => boolean
  onPick: (a: KeyAction) => void
}) {
  const q = query.trim().toLowerCase()
  const groups = GROUPS.map(g => ({
    ...g,
    choices: g.choices.filter(c => (!keysOnly || c.action.type === 'key') && (!q || c.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q))),
  })).filter(g => g.choices.length)
  const btn = 'rounded-md border px-1.5 py-1 text-xs font-medium leading-tight [overflow-wrap:anywhere] hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'

  return (
    <>
      {groups.map(g => (
        <section key={g.name}>
          <h3 className="mb-1 text-xs font-semibold text-mute">{g.name}</h3>
          <div className="grid grid-cols-4 gap-1">
            {g.choices.map(c => {
              const on = isOn(c.action)
              return (
                <button key={c.label} type="button" aria-pressed={on} disabled={disabled} onClick={() => onPick(c.action)}
                  className={`${btn} ${on ? 'border-select bg-cap' : 'border-line'}`}>
                  {c.label}
                </button>
              )
            })}
          </div>
        </section>
      ))}
      {!groups.length && <p className="text-sm text-mute">Nothing matches “{query}”.</p>}
    </>
  )
}

// A key choice: a button showing the current key that opens the Key map tab's searchable grid in a popover
// (native `popover`: Esc and clicking outside close it).
export function KeySelect({ label, value, onChange, none, narrow, placeholder = 'Different keys' }: {
  label: string; value: number | null; onChange: (usage: number) => void; none?: boolean; narrow?: boolean
  placeholder?: string // shown when value is null
}) {
  const id = useId()
  const pop = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const choose = (usage: number) => { onChange(usage); pop.current?.hidePopover() }
  const name = value === null ? placeholder : value === 0 ? 'None' : usageName(value)

  return (
    <div className={`flex items-center gap-3 ${narrow ? '' : 'justify-between'}`}>
      {!narrow && <span className="text-sm font-medium">{label}</span>}
      <button type="button" popoverTarget={id} aria-label={`${label}: ${name}`}
        className={`${narrow ? 'w-full' : 'w-40'} flex items-center justify-between gap-1 rounded-md border border-line bg-cap px-2 py-1 text-left text-sm hover:border-mute focus-visible:outline-2 focus-visible:outline-ink ${
          value ? '' : 'text-mute'}`}>
        <span className="truncate">{name}</span>
        <svg viewBox="0 0 24 24" className="size-3.5 shrink-0 text-mute" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div ref={pop} id={id} popover="auto" aria-label={`Choose ${label}`}
        onToggle={e => { if (e.newState === 'open') e.currentTarget.querySelector('input')?.focus() }}
        className="m-auto max-h-[80dvh] w-[min(440px,92vw)] overflow-auto rounded-lg border border-line bg-plate p-3 text-left text-ink shadow-xl backdrop:bg-black/30">
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{label}</h3>
            <input type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search keys" aria-label="Search keys"
              className="min-w-0 flex-1 rounded-md border border-line bg-cap px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ink" />
            {none && (
              <button type="button" onClick={() => choose(0)}
                className={`rounded-md border px-3 py-1 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink ${value === 0 ? 'border-select bg-cap' : 'border-line'}`}>
                None
              </button>
            )}
          </div>
          <ChoiceGroups query={query} keysOnly isOn={a => a.type === 'key' && a.usage === value} onPick={a => a.type === 'key' && choose(a.usage)} />
        </div>
      </div>
    </div>
  )
}

// How a key plays its macro: the modes the hub offers for the HE80 (repeat count 1–255, until pressed again). "While
// held" (mode 3) exists for other models but plays on after release on firmware 1.08, so it isn't offered.
function MacroPlay({ value, onChange }: { value: Extract<KeyAction, { type: 'macro' }>; onChange: (a: KeyAction) => void }) {
  const mode = value.mode === 0 ? 1 : value.mode // 0 (play once, never written by the hub) shows as "1 time"
  const field = 'rounded-md border border-line bg-cap px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ink'
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs font-semibold text-mute">Play</span>
      <select value={mode} aria-label="How the macro plays" className={field}
        onChange={e => onChange({ ...value, mode: Number(e.currentTarget.value), repeat: Math.max(1, value.repeat) })}>
        <option value={1}>a number of times</option>
        <option value={2}>until pressed again</option>
        {mode === 3 && <option value={3}>while held (not supported)</option>}
      </select>
      {mode === 1 && (
        <label className="flex items-center gap-1.5">
          {/* applied on leaving the box or Enter, like the macro waits */}
          <input type="number" min={1} max={255} key={value.repeat} defaultValue={Math.max(1, value.repeat)} aria-label="Times to play"
            onBlur={e => {
              const n = Math.min(255, Math.max(1, Math.round(Number(e.currentTarget.value)) || 1))
              if (n !== value.repeat || value.mode !== 1) onChange({ ...value, mode: 1, repeat: n })
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            className={`${field} w-16 text-right`} />
          {value.repeat === 1 ? 'time' : 'times'}
        </label>
      )}
    </div>
  )
}
