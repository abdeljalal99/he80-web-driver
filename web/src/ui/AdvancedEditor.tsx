// Advanced keys: Tap / Hold (MT), Toggle (TGL), SOCD, Rapid Switch (RS) and DKS. They live in the key map (0x22), DKS
// keys also in a DKS slot (0x28). Edits go to the whole board (key map + slots); App runs them through
// lib/advanced.ts `tidy`, which keeps pairs whole and empties unused slots, and saves them in a safe order.

import { KEYS, usageName } from '../lib/keys.ts'
import { isAdvanced } from '../lib/describe.ts'
import { partnerOf, type Board } from '../lib/advanced.ts'
import {
  ADVANCED_MAX, DKS_TRAVEL, MT_TIME, dksState, freeDksSlot, newDksSlot, setDksHold, toggleDksCell, withDksState, type DksSlot, type DksState, type KeyAction,
} from '../lib/protocol.ts'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Heading } from './Inspector.tsx'
import { KeySelect } from './KeyPicker.tsx'
import { ResetIcon } from './TravelEditor.tsx'

type Kind = 'normal' | 'mt' | 'tgl' | 'socd' | 'rs' | 'dks'
type Mode = Exclude<Kind, 'normal'>

// Small line icons (24 × 24, currentColor).
const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {paths}
  </svg>
)
const MODES: { k: Mode; label: string; help: string; needs?: string; icon: ReactNode }[] = [
  { k: 'mt', label: 'Tap / Hold', help: 'Tap sends one key, holding it sends another (e.g. tap Esc, hold Ctrl).',
    icon: icon(<><circle cx="5" cy="12" r="2" fill="currentColor" /><path d="M11 12h8" /><circle cx="19" cy="12" r="2" /></>) },
  { k: 'tgl', label: 'Toggle', help: 'A quick tap keeps the key held down until you tap it again; a long press works normally.',
    icon: icon(<><rect x="2" y="7" width="20" height="10" rx="5" /><circle cx="16" cy="12" r="2.5" fill="currentColor" /></>) },
  { k: 'socd', label: 'SOCD', needs: 'Select exactly two keys', help: 'Two keys (e.g. A and D): choose what happens while both are held.',
    icon: icon(<><path d="M9 12H2m3-3-3 3 3 3" /><path d="M15 12h7m-3-3 3 3-3 3" /></>) },
  { k: 'rs', label: 'Rapid Switch', needs: 'Select exactly two keys', help: 'Two keys held together: only the one pressed further down counts.',
    icon: icon(<><path d="M4 8h15m-3-3 3 3-3 3" /><path d="M20 16H5m3-3-3 3 3 3" /></>) },
  { k: 'dks', label: 'DKS', needs: 'Select one key', help: 'Dynamic keystroke: up to 4 keys, each tapped or held at different points of the press.',
    icon: icon(<><path d="M12 3v18" /><path d="M8 6h8M9 11h6M10 16h4" /></>) },
]
const isPair = (k: Kind | null) => k === 'socd' || k === 'rs'

const ownUsage = (index: number) => KEYS.find(k => k.index === index)?.usage ?? 4
const kindOf = (a: KeyAction): Kind =>
  a.type === 'mt' || a.type === 'tgl' || a.type === 'socd' || a.type === 'rs' || a.type === 'dks' ? a.type : 'normal'
const LCTRL = 224

export function AdvancedEditor({ selected, board, edit, locked }: {
  selected: number[]
  board: Board
  edit: (change: (b: Board) => Board) => void
  locked?: string
}) {
  const { keymap, dks } = board
  const current = selected.map(i => keymap[i])
  const kinds = new Set(current.map(kindOf))
  const kind = kinds.size === 1 ? [...kinds][0] : null
  const now = !selected.length ? 'Select keys on the keyboard.'
    : !kind ? 'Mixed functions selected.'
    : `Currently: ${MODES.find(m => m.k === kind)?.label ?? 'normal key'}`
  const used = keymap.filter(isAdvanced).length
  const adding = current.filter(a => !isAdvanced(a)).length
  const full = used + adding > ADVANCED_MAX
  // Pair partners outside the selection (tidy updates or clears them; shown so the user knows).
  const partners = selected.some(i => { const p = partnerOf(keymap, i); return p !== undefined && !selected.includes(p) })
  /** Applies `change` to every selected key's entry. */
  const editKeys = (change: (a: KeyAction, index: number) => KeyAction) =>
    edit(b => ({ ...b, keymap: b.keymap.map((a, i) => (selected.includes(i) ? change(a, i) : a)) }))

  const setKind = (k: Kind) => {
    const [x, y] = selected
    if (isPair(k) && selected.length !== 2) return
    if (k === 'dks') {
      if (selected.length !== 1 || kind === 'dks') return
      return edit(b => {
        const slot = freeDksSlot(b.keymap, b.dks)
        if (slot < 0) return b
        return { keymap: b.keymap.map((a, i) => (i === x ? { type: 'dks', slot } : a)), dks: b.dks.map((s, i) => (i === slot ? newDksSlot(ownUsage(x)) : s)) }
      })
    }
    const first = keymap[x]
    const pair: KeyAction = k === 'socd'
      ? { type: 'socd', mode: first.type === 'socd' ? first.mode : 3, key1: ownUsage(x), key2: ownUsage(y) }
      : { type: 'rs', key1: ownUsage(x), key2: ownUsage(y) }
    editKeys((a, i) => {
      if (isPair(k)) return pair
      if (k === 'normal') return isAdvanced(a) ? { type: 'default' } : a
      if (k === 'mt') return a.type === 'mt' ? a : { type: 'mt', tap: ownUsage(i), hold: LCTRL, time: MT_TIME.default / 10 }
      return a.type === 'tgl' ? a : { type: 'tgl', usage: ownUsage(i) }
    })
  }

  const mt = kind === 'mt' ? current as Extract<KeyAction, { type: 'mt' }>[] : []
  const tgl = kind === 'tgl' ? current as Extract<KeyAction, { type: 'tgl' }>[] : []
  const socd = kind === 'socd' ? current as Extract<KeyAction, { type: 'socd' }>[] : []
  const pairs = isPair(kind) ? current as Extract<KeyAction, { type: 'socd' | 'rs' }>[] : []
  const same = <T,>(xs: T[]) => (xs.every(x => x === xs[0]) ? xs[0] : null)

  return (
    <fieldset disabled={!!locked} className="grid min-w-0 gap-4">
      <Heading selected={selected} />
      {locked && <p className="-mt-2 text-sm text-mute">{locked}</p>}
      {/* Always one line, so the panel doesn't jump when the selection changes. */}
      <p className="-mt-2 truncate text-sm text-mute">{now}</p>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Advanced function</span>
          <button type="button" disabled={!current.some(isAdvanced)} onClick={() => setKind('normal')}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40">
            <ResetIcon /> Normal key
          </button>
        </div>
        <div role="radiogroup" aria-label="Advanced function" className="grid grid-cols-5 gap-1">
          {MODES.map(m => {
            const wrongCount = (isPair(m.k) && selected.length !== 2) || (m.k === 'dks' && selected.length !== 1)
            return (
              <button key={m.k} type="button" role="radio" aria-checked={kind === m.k}
                disabled={!selected.length || (kind !== m.k && (full || wrongCount))} onClick={() => setKind(m.k)}
                title={wrongCount && m.needs ? `${m.label}: ${m.needs.toLowerCase()}` : m.help}
                className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[11px] leading-tight hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40 ${
                  kind === m.k ? 'border-select bg-cap' : 'border-line'}`}>
                {m.icon}{m.label}
              </button>
            )
          })}
        </div>
        <dl className="grid gap-1 rounded-md bg-cap px-3 py-2 text-xs">
          {MODES.map(m => (
            <div key={m.k}><dt className="inline font-medium">{m.label}: </dt><dd className="inline text-mute">{m.help}{m.needs && ` ${m.needs}.`}</dd></div>
          ))}
        </dl>
        <p className="text-xs text-mute">
          {used} of {ADVANCED_MAX} advanced keys used.{full && ' Remove some before adding more.'}
        </p>
      </div>

      {kind === 'mt' && (
        <>
          <KeySelect label="Tap" value={same(mt.map(a => a.tap))} onChange={u => editKeys(a => (a.type === 'mt' ? { ...a, tap: u } : a))} />
          <KeySelect label="Hold" value={same(mt.map(a => a.hold))} onChange={u => editKeys(a => (a.type === 'mt' ? { ...a, hold: u } : a))} />
          <HoldTime value={same(mt.map(a => a.time))} onChange={t => editKeys(a => (a.type === 'mt' ? { ...a, time: t } : a))} />
        </>
      )}
      {pairs.length > 0 && (
        <p className="-mt-2 text-xs text-mute">
          {[...new Set(pairs.map(a => `${usageName(a.key1)} + ${usageName(a.key2)}`))].join(', ')}
          {partners && ' (the other key of the pair changes too)'}
        </p>
      )}
      {kind === 'socd' && <SocdMode keys={[socd[0].key1, socd[0].key2]} value={same(socd.map(a => a.mode))}
        onChange={mode => editKeys(a => (a.type === 'socd' ? { ...a, mode } : a))} />}
      {kind === 'dks' && selected.length === 1 && current[0].type === 'dks' && (
        <DksEditor slot={current[0].slot} value={dks[current[0].slot] ?? newDksSlot(ownUsage(selected[0]))} edit={edit} />
      )}
      {kind === 'dks' && selected.length > 1 && <p className="-mt-2 text-xs text-mute">Select one DKS key to edit it.</p>}
      {kind === 'tgl' && (
        <KeySelect label="Key to toggle" value={same(tgl.map(a => a.usage))} onChange={u => editKeys(a => (a.type === 'tgl' ? { ...a, usage: u } : a))} />
      )}
    </fieldset>
  )
}

// Hold time in ms (the keyboard stores it in 10 ms steps).
function HoldTime({ value, onChange }: { value: number | null; onChange: (tenMs: number) => void }) {
  const ms = value === null ? null : value * 10
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Hold time</span>
        <span className="text-sm">{ms === null ? 'different' : `${ms} ms`}</span>
      </div>
      <input type="range" aria-label="Hold time" min={MT_TIME.min} max={MT_TIME.max} step={10} value={ms ?? MT_TIME.default}
        onChange={e => onChange(Math.max(1, Math.round(Number(e.currentTarget.value) / 10)))}
        className={`mt-1 w-full accent-[var(--color-deep)] ${ms === null ? 'opacity-50' : ''}`} />
      <p className="text-xs text-mute">Hold longer than this to get the hold key<br />{MT_TIME.min}–{MT_TIME.max} ms</p>
    </div>
  )
}


// SOCD modes (docs/TECHNICAL.md): 3 last input wins, 1 key 1 wins, 2 key 2 wins, 4 neutral.
function SocdMode({ keys: [k1, k2], value, onChange }: { keys: number[]; value: number | null; onChange: (mode: number) => void }) {
  const modes: [number, string][] = [[3, 'Last pressed wins'], [1, `${usageName(k1)} wins`], [2, `${usageName(k2)} wins`], [4, 'Neither (both cancel)']]
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">Both held</span>
      <select value={value ?? ''} onChange={e => onChange(Number(e.currentTarget.value))}
        className="w-40 rounded-md border border-line bg-cap px-2 py-1 text-sm focus-visible:outline-2 focus-visible:outline-ink">
        {value === null && <option value="" disabled>Different modes</option>}
        {modes.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
      </select>
    </label>
  )
}

// DKS: travel points and a 4 × 4 grid (bound keys × stages), like the hub's DksActionGrid. Clicking a cell cycles
// nothing → tap → hold (until the next stage) → nothing; holds in neighbouring cells join into one longer hold.
const STAGES = [['Press', '↓'], ['Bottom', '⤓'], ['Lift', '↑'], ['Release', '⤒']]
const STATE_NAMES: Record<DksState, string> = { 0: 'nothing', 1: 'tap', 2: 'hold' }

// What a DKS cell draws: a dot for a press (a tap, or the start of a hold), bar halves for a hold passing through, and a
// tick where a hold is released.
function cellMarks(s: DksSlot, key: number, stage: number) {
  const v = dksState(s, key, stage)
  const heldBefore = stage > 0 && dksState(s, key, stage - 1) === 2
  return { dot: v === 1 || (v === 2 && !heldBefore), left: heldBefore, right: v === 2, tick: heldBefore && v !== 2 }
}

function DksEditor({ slot, value: s, edit }: { slot: number; value: DksSlot; edit: (change: (b: Board) => Board) => void }) {
  const onChange = (f: (s: DksSlot) => DksSlot) => edit(b => ({ ...b, dks: b.dks.map((x, i) => (i === slot ? f(x ?? s) : x)) }))
  const [start, bottom] = s.points
  const setPoints = (st: number, bt: number) => onChange(x => ({ ...x, points: [st, bt, bt, st] }))
  const at = [start, bottom, bottom, start]
  // Like the hub: click = tap on/off (or remove the hold it's part of); drag from one cell to a later one = hold from
  // the first stage, released at the cell you let go on. While dragging, the row shows the result as a preview.
  // The ref is the source of truth: pointer events can arrive faster than React re-renders, so handlers reading state
  // would see an old drag. The state copy only drives the preview.
  type Drag = { key: number; from: number; to: number }
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const moveDrag = (d: Drag | null) => { dragRef.current = d; setDrag(d) }
  useEffect(() => {
    const up = () => {
      const d = dragRef.current
      if (!d) return
      moveDrag(null)
      onChange(x => (d.to > d.from ? setDksHold(x, d.key, d.from, d.to) : toggleDksCell(x, d.key, d.from)))
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  })
  // Preview: what the row would become after the drag in progress, or after clicking the hovered cell. Marks that would
  // appear or disappear are drawn faded, so the preview shows exactly what changes.
  const [hover, setHover] = useState<{ key: number; stage: number } | null>(null)
  const preview = (key: number) =>
    drag ? (drag.key === key && drag.to > drag.from ? setDksHold(s, key, drag.from, drag.to) : s)
    : hover?.key === key ? toggleDksCell(s, key, hover.stage) : s

  return (
    <div className="grid gap-3">
      <Travel label="Start" value={start} onChange={v => setPoints(v, bottom)} help="Press and Release happen here" />
      <Travel label="Bottom" value={bottom} onChange={v => setPoints(start, v)} help="Bottom and Lift happen here" />
      <div role="grid" aria-label="Dynamic keystroke actions" className="grid grid-cols-[minmax(0,1fr)_repeat(4,2.75rem)] items-center gap-y-1 text-center">
        <div role="row" className="contents">
          <span role="columnheader" className="text-left text-xs text-mute">Key</span>
          {STAGES.map(([name, icon], n) => (
            <span key={name} role="columnheader" className="text-xs leading-tight">
              <span aria-hidden className="block">{icon}</span>{name}<span className="block text-mute">{(at[n] / 10).toFixed(1)}</span>
            </span>
          ))}
        </div>
        {s.keys.map((usage, key) => (
          <div key={key} role="row" className="contents">
            <div role="gridcell" className="pr-2">
              <KeySelect label={`Key ${key + 1}`} value={usage} none narrow
                onChange={u => onChange(x => {
                  const next = { ...x, keys: x.keys.map((k, n) => (n === key ? u : k)) }
                  return u ? next : [0, 1, 2, 3].reduce((y, st) => withDksState(y, key, st, 0), next) // None: clear its cells
                })} />
            </div>
            {STAGES.map(([name], stage) => {
              const now = cellMarks(s, key, stage), next = cellMarks(preview(key), key, stage)
              const mark = (m: keyof typeof now) => (now[m] || next[m] ? (now[m] === next[m] ? 'bg-deep' : 'bg-deep opacity-35') : null)
              const v = dksState(s, key, stage)
              const dot = mark('dot'), left = mark('left'), right = mark('right'), tick = mark('tick')
              return (
                <button key={name} type="button" role="gridcell" disabled={!usage}
                  onPointerDown={e => {
                    if (e.button !== 0 || !usage) return // disabled buttons still get pointer events
                    e.currentTarget.releasePointerCapture(e.pointerId) // so the cells under the pointer get pointerenter
                    moveDrag({ key, from: stage, to: stage })
                  }}
                  onPointerEnter={() => {
                    if (usage) setHover({ key, stage })
                    const d = dragRef.current
                    if (d?.key === key) moveDrag({ ...d, to: Math.max(d.from, stage) })
                  }}
                  onPointerLeave={() => setHover(null)}
                  onClick={e => { if (e.detail === 0) onChange(x => toggleDksCell(x, key, stage)) }} // Enter / Space
                  aria-label={`Key ${key + 1}, ${name}: ${STATE_NAMES[v]}${now.tick ? ', released here' : ''}`}
                  className="relative h-8 touch-none rounded focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-30">
                  {left && <span className={`absolute top-1/2 left-0 h-1.5 w-1/2 -translate-y-1/2 ${left}`} />}
                  {right && <span className={`absolute top-1/2 right-0 h-1.5 w-1/2 -translate-y-1/2 ${right}`} />}
                  {dot && <span className={`relative inline-block size-3 rounded-full align-middle ${dot}`} />}
                  {tick && !dot && <span className={`relative inline-block h-3 w-1 align-middle ${tick}`} />}
                  {!dot && !left && !right && <span className="text-mute">+</span>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      {/* Legend drawn with the same marks as the cells, so it reads at a glance. */}
      <div className="grid gap-1 rounded-md bg-cap px-3 py-2 text-xs text-mute">
        <p className="flex items-center gap-1.5">
          <span className="inline-block size-3 shrink-0 rounded-full bg-deep" />
          <span><b className="font-medium text-ink">Click</b> a cell: tap (press and release) on or off.</span>
        </p>
        <p className="flex items-center gap-1.5">
          <span className="relative inline-flex w-9 shrink-0 items-center"><span className="size-3 rounded-full bg-deep" /><span className="h-1.5 flex-1 bg-deep" /><span className="h-3 w-1 bg-deep" /></span>
          <span><b className="font-medium text-ink">Drag</b> to a later cell: hold, released where you let go.</span>
        </p>
        <p>Click a hold to remove it.</p>
      </div>
    </div>
  )
}

// One DKS travel point, 0.1 mm.
function Travel({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm">{(value / 10).toFixed(1)} mm</span>
      </div>
      <input type="range" aria-label={`${label} point`} min={DKS_TRAVEL.min} max={DKS_TRAVEL.max} step={1} value={value}
        onChange={e => onChange(Number(e.currentTarget.value))} className="mt-1 w-full accent-[var(--color-deep)]" />
      <p className="text-xs text-mute">{help} · {DKS_TRAVEL.min / 10}–{DKS_TRAVEL.max / 10} mm</p>
    </div>
  )
}
