// Macros tab: 20 macro slots, each a list of steps (press or release a key, then wait). Saved automatically like every
// other editor; the whole macro region is rebuilt on save (protocol.ts encodeMacros). Assigning a macro to a key is
// done on the Key map tab (step 11c).

import { useEffect, useRef, useState } from 'react'
import { KEYS, usageName } from '../lib/keys.ts'
import { MACRO_SLOTS, WAIT, fits, fromRecording, isPress, keyEvent, leftPressed, normalize, usage, usageOf, withPress, type Recorded } from '../lib/macros.ts'
import type { KeyAction, Macro, MacroEvent } from '../lib/protocol.ts'
import { KeySelect } from './KeyPicker.tsx'

const stepName = (e: MacroEvent) => (e.flags & 0x20 ? usageName(e.code) : `Mouse ${e.code}`)
const iconBtn = 'grid size-7 place-items-center rounded text-mute hover:bg-cap hover:text-ink focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-30'

export function MacroEditor({ macros, keymap, fnLayer, edit, unassign, locked }: {
  macros: Macro[]
  keymap: KeyAction[] | undefined
  fnLayer: KeyAction[] | undefined
  unassign: (slot: number) => void // puts every key that plays this macro (both layers) back to its default
  edit: (change: (m: Macro[]) => Macro[]) => void
  locked?: string
}) {
  // Only macros with steps are listed, plus the selected one while it's still empty (just created, or cleared).
  const [slot, setSlot] = useState<number | null>(() => { const i = macros.findIndex(Boolean); return i < 0 ? null : i })
  const [full, setFull] = useState(false) // last edit refused: no room left
  const listed = macros.flatMap((m, i) => (m || i === slot ? [i] : []))
  const free = macros.findIndex((m, i) => !m && i < MACRO_SLOTS) // first unused slot the hub can show
  const [confirmDelete, setConfirmDelete] = useState(false)
  const select = (i: number | null) => { setSlot(i); setFull(false); setConfirmDelete(false) }
  const steps = (slot !== null && macros[slot]) || []
  const { used, total } = usage(macros)
  const plays = (a: KeyAction | undefined) => a?.type === 'macro' && a.index === slot
  const usedBy = [
    ...KEYS.filter(k => plays(keymap?.[k.index])).map(k => k.label),
    ...KEYS.filter(k => plays(fnLayer?.[k.index])).map(k => `Fn+${k.label}`),
  ]
  const stuck = leftPressed(steps)

  /** Replaces this macro's steps, unless the result wouldn't fit in the keyboard's macro storage. */
  const setSteps = (change: (s: MacroEvent[]) => MacroEvent[]) => {
    const next = macros.map((m, i) => (i === slot ? normalize(change(m ?? [])) : m))
    setFull(!fits(next))
    if (fits(next)) edit(() => next)
  }
  const update = (i: number, e: MacroEvent) => setSteps(s => s.map((x, n) => (n === i ? e : x)))
  const move = (i: number, by: number) => setSteps(s => {
    const t = s.slice()
    ;[t[i], t[i + by]] = [t[i + by], t[i]]
    return t
  })
  const addKey = (u: number) => setSteps(s => {
    const t = s.length ? [...s.slice(0, -1), { ...s[s.length - 1], delay: WAIT.default }] : [] // the old last step now waits
    return [...t, keyEvent(u, true, WAIT.default), keyEvent(u, false, 0)]
  })

  // Recording (11b): while on, every key press/release on the page goes into the macro instead of acting on the page.
  // The ref holds the events (handlers can't wait for a re-render); the state copy shows the count.
  const [rec, setRec] = useState<Recorded[] | null>(null)
  const recRef = useRef<Recorded[] | null>(null)
  const [fixedWait, setFixedWait] = useState(false) // replace the recorded timing with WAIT.default between steps
  const room = Math.floor((total - used) / 4) - (steps.length ? 0 : 1) // steps that still fit
  const stop = () => {
    const events = recRef.current
    recRef.current = null
    setRec(null)
    if (events?.length) setSteps(s => [...s, ...fromRecording(events, fixedWait ? WAIT.default : undefined)])
  }
  const stopRef = useRef(stop)
  useEffect(() => { stopRef.current = stop }) // key handlers below always call the latest stop()
  const recording = rec !== null
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault() // the key is for the macro, not the page (Ctrl+W mustn't close the tab)
      e.stopPropagation()
      const usage = usageOf(e.code), events = recRef.current
      if (e.repeat || usage === undefined || !events) return
      const press = e.type === 'keydown'
      if (!press && !leftPressed(events.map(x => keyEvent(x.usage, x.press, 0))).includes(usage)) return // held before Record
      const next = [...events, { usage, press, time: e.timeStamp }]
      recRef.current = next
      setRec(next)
      // Stop before running out of room (keys still held get a release step at the end).
      if (next.length + leftPressed(next.map(x => keyEvent(x.usage, x.press, 0))).length >= room) stopRef.current()
    }
    const lost = () => stopRef.current() // switching windows: key releases would be missed
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    window.addEventListener('blur', lost)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
      window.removeEventListener('blur', lost)
    }
  }, [recording, room])

  return (
    <div className="grid min-h-0 min-w-0 flex-1 gap-4 md:grid-cols-[14rem_minmax(0,36rem)]">
      {/* Slot list */}
      <div className="flex min-h-0 flex-col gap-3">
      <Storage used={used} total={total} />
      <button type="button" disabled={!!locked || free < 0} onClick={() => select(free)}
        title={free < 0 ? `All ${MACRO_SLOTS} macros are in use` : undefined}
        className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40">
        + New macro
      </button>
      <nav aria-label="Macros" className="grid min-h-0 content-start gap-1 overflow-y-auto">
        {listed.map(i => (
          <button key={i} type="button" aria-current={slot === i} onClick={() => select(i)}
            className={`flex items-center justify-between rounded-md px-3 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-ink ${
              slot === i ? 'bg-ink text-plate' : 'hover:bg-cap'}`}>
            <span className="font-medium">Macro {i + 1}</span>
            <span className={slot === i ? 'opacity-80' : 'text-mute'}>{macros[i] ? `${macros[i]!.length} steps` : 'new'}</span>
          </button>
        ))}
      </nav>
      </div>

      {/* Editor */}
      {slot === null ? (
        <p className="self-start rounded-xl border border-line p-4 text-sm text-mute">No macros yet. Click <b className="font-medium text-ink">New macro</b> to make one.</p>
      ) : (
      <fieldset disabled={!!locked} aria-label={`Macro ${slot + 1}`} className="grid min-h-0 min-w-0 content-start gap-3 overflow-y-auto rounded-xl border border-line p-4 [scrollbar-gutter:stable]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="whitespace-nowrap text-lg font-semibold">Macro {slot + 1}</h2>
          {confirmDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">
                Delete Macro {slot + 1}?{usedBy.length > 0 && <span className="font-normal text-mute"> <Caps keys={usedBy} /> will go back to normal.</span>}
              </span>
              <button type="button" onClick={() => {
                if (usedBy.length) unassign(slot)
                setSteps(() => [])
                const other = listed.find(i => i !== slot && macros[i]) // show the next remaining macro, if any
                select(other ?? null)
              }}
                className="rounded-md bg-write px-3 py-1.5 font-medium text-plate focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-write hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
              Delete macro
            </button>
          )}
        </div>
        {locked && <p className="-mt-2 text-sm text-mute">{locked}</p>}
        <p className="-mt-2 text-sm text-mute">
          {usedBy.length ? <>Played by <Caps keys={usedBy} /></> : 'Not on any key yet. Put it on a key on the Key map tab.'}
        </p>

        {steps.length > 0 && (
          <ol className="grid gap-1">
            {steps.map((e, i) => (
              <li key={i} className="flex items-center gap-2 rounded-md bg-cap px-2 py-1">
                <span className="w-5 text-right text-xs text-mute">{i + 1}</span>
                <button type="button" onClick={() => update(i, withPress(e, !isPress(e)))} title="Switch between press and release"
                  className="w-20 rounded-md border border-line px-2 py-1 text-xs font-medium hover:bg-plate focus-visible:outline-2 focus-visible:outline-ink">
                  {isPress(e) ? '↓ Press' : '↑ Release'}
                </button>
                <div className="w-28">
                  {e.flags & 0x20
                    ? <KeySelect label={`Step ${i + 1} key`} value={e.code} narrow onChange={u => update(i, { ...e, code: u })} />
                    : <span className="text-sm">{stepName(e)}</span>}
                </div>
                <label className="ml-auto flex items-center gap-1 text-xs text-mute">
                  {i < steps.length - 1 ? (
                    <>
                      then wait
                      {/* Applied on leaving the box or Enter, so typing "10" doesn't get clamped at "1". */}
                      <input type="number" min={WAIT.min} max={WAIT.max} key={e.delay} defaultValue={e.delay} aria-label={`Wait after step ${i + 1}, ms`}
                        onBlur={ev => { const v = Number(ev.currentTarget.value); if (v !== e.delay) update(i, { ...e, delay: v }) }}
                        onKeyDown={ev => { if (ev.key === 'Enter') ev.currentTarget.blur() }}
                        className="w-16 rounded-md border border-line bg-plate px-1.5 py-0.5 text-right text-sm text-ink focus-visible:outline-2 focus-visible:outline-ink" />
                      ms
                    </>
                  ) : 'end'}
                </label>
                <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move step ${i + 1} up`}>↑</button>
                <button type="button" className={iconBtn} disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label={`Move step ${i + 1} down`}>↓</button>
                <button type="button" className={iconBtn} onClick={() => setSteps(s => s.filter((_, n) => n !== i))} aria-label={`Delete step ${i + 1}`}>✕</button>
              </li>
            ))}
          </ol>
        )}
        {!steps.length && <p className="text-sm text-mute">This macro is empty. Add a key to start.</p>}

        {recording ? (
          <div role="status" className="flex items-center gap-3 rounded-md border border-write px-3 py-2">
            <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-write" aria-hidden />
            <span className="text-sm">
              <b className="font-medium">Recording:</b> type now. {rec.length} key {rec.length === 1 ? 'event' : 'events'} so far;
              keys go into the macro, not to the page.
            </span>
            <button type="button" onClick={stop}
              className="ml-auto rounded-md bg-write px-3 py-1.5 text-sm font-medium text-plate focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
              Stop
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-36"><KeySelect label="Add key" value={null} placeholder="+ Add key" narrow onChange={addKey} /></div>
            <button type="button" disabled={room < 2} onClick={() => { recRef.current = []; setRec([]) }}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40">
              <span className="size-2.5 rounded-full bg-write" aria-hidden /> Record
            </button>
            <label className="flex items-center gap-1.5 text-xs text-mute">
              <input type="checkbox" checked={fixedWait} onChange={e => setFixedWait(e.currentTarget.checked)} className="accent-[var(--color-deep)]" />
              Fixed {WAIT.default} ms waits
            </label>
          </div>
        )}
        {stuck.length > 0 && (
          <p className="text-sm text-write">{stuck.map(usageName).join(', ')} {stuck.length > 1 ? 'are' : 'is'} pressed but never released, so {stuck.length > 1 ? 'they' : 'it'} would stay held down.</p>
        )}
        {full && <p role="alert" className="text-sm text-write">Not enough room in the keyboard’s macro storage. Remove steps here or in another macro.</p>}
      </fieldset>
      )}
    </div>
  )
}

// All macros share 624 bytes on the keyboard: 4 per macro plus 4 per step.
function Storage({ used, total }: { used: number; total: number }) {
  const pct = Math.round((used / total) * 100)
  return (
    <div className="grid shrink-0 gap-1 px-1 text-xs text-mute">
      <div className="flex justify-between"><span>Storage</span><span>{pct}% used</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="meter" aria-label="Macro storage used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={total}>
        <div className={`h-full ${pct > 90 ? 'bg-write' : 'bg-deep'}`} style={{ width: `${pct}%` }} />
      </div>
      <span>Room for about {Math.max(0, Math.floor((total - used) / 4) - 1)} more steps</span>
    </div>
  )
}

// Key names drawn as small keycaps, so short labels like "." or "," read as keys, not punctuation.
function Caps({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
      {keys.map(k => (
        <kbd key={k} className="min-w-6 rounded border border-b-2 border-line bg-cap px-1.5 py-0.5 text-center font-sans text-xs font-semibold text-ink">{k}</kbd>
      ))}
    </span>
  )
}
