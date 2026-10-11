// Actuation & rapid trigger editor for the selected keys. Every edit is saved to the keyboard automatically
// (debounced in App).

import { useState } from 'react'
import { mm } from '../lib/describe.ts'
import { TRAVEL, clamp, fullTravel, resetTravel, withFullTravel, type KeyTravel } from '../lib/protocol.ts'
import { Empty, Heading } from './Inspector.tsx'

type Limit = { min: number; max: number }

interface Props {
  selected: number[]
  rt: KeyTravel[] // draft values (what the caps show)
  edit: (change: (t: KeyTravel) => KeyTravel) => void // applies `change` to every selected key
  locked?: string // reason editing is off (e.g. viewing a backup file)
}

/** The shared value of `vals`, or null when the selected keys differ ("mixed"). */
const common = (vals: number[]) => (vals.every(v => v === vals[0]) ? vals[0] : null)

export function TravelEditor({ selected, rt, edit, locked }: Props) {
  // Like the hub: one sensitivity for press and release unless "independent release" is on. Hooks must run on
  // every render, so this sits before the early return below.
  const [separate, setSeparate] = useState(false)
  if (!selected.length) return <Empty />
  const t = selected.map(i => rt[i])
  const withRt = t.filter(x => x.press > 0)
  const on = withRt.length
  const rtState = on === 0 ? 'off' : on === t.length ? 'on' : 'mixed'
  const ft = t.filter(fullTravel).length
  const independent = separate || withRt.some(x => x.press !== x.release)
  const lowPress = withRt.some(x => x.press <= TRAVEL.rtWarn)
  const lowRelease = withRt.some(x => x.release <= TRAVEL.rtWarn)

  return (
    <fieldset disabled={!!locked} className="grid min-w-0 gap-3">
      <Heading selected={selected} />
      {locked && <p className="-mt-2 text-sm text-mute">{locked}</p>}

      <MmField label="Actuation point" value={common(t.map(x => x.actuation))} limit={TRAVEL.actuation}
        help="Where a press registers"
        onChange={v => edit(x => ({ ...x, actuation: v }))} />

      <Toggle label="Rapid trigger" checked={rtState === 'on'}
        help={rtState === 'mixed' ? `On for ${on} of ${t.length} keys` : 'Press and release by direction, not a fixed point'}
        // Turning on gives keys without RT the hub's default of 0.10 mm; turning off clears both sensitivities.
        onChange={next => edit(x => next
          ? (x.press ? x : { ...x, press: TRAVEL.defaultRt, release: TRAVEL.defaultRt })
          : withFullTravel({ ...x, press: 0, release: 0 }, false))} />

      {rtState !== 'off' && (
        <>
          <Toggle label="Independent release sensitivity" checked={independent}
            help="Set press and release separately"
            // Turning it off makes release match press again.
            onChange={next => {
              setSeparate(next)
              if (!next) edit(x => (x.press ? { ...x, release: x.press } : x))
            }} />
          {independent ? (
            <div className="grid grid-cols-2 gap-4">
              <MmField label="Press" value={common(withRt.map(x => x.press))} limit={TRAVEL.rt}
                help="Down again to re-press" warn={lowPress && 'Too sensitive, may press by itself'}
                onChange={v => edit(x => (x.press ? { ...x, press: v } : x))}
                reset={() => edit(x => (x.press ? { ...x, press: TRAVEL.defaultRt } : x))} />
              <MmField label="Release" value={common(withRt.map(x => x.release))} limit={TRAVEL.rt}
                help="Up to release" warn={lowRelease && 'Too sensitive, may release by itself'}
                onChange={v => edit(x => (x.press ? { ...x, release: v } : x))}
                reset={() => edit(x => (x.press ? { ...x, release: TRAVEL.defaultRt } : x))} />
            </div>
          ) : (
            <MmField label="Sensitivity" value={common(withRt.map(x => x.press))} limit={TRAVEL.rt}
              help="Movement needed to re-press or release" warn={(lowPress || lowRelease) && 'Too sensitive, may press or release by itself'}
              onChange={v => edit(x => (x.press ? { ...x, press: v, release: v } : x))}
              reset={() => edit(x => (x.press ? { ...x, press: TRAVEL.defaultRt, release: TRAVEL.defaultRt } : x))} />
          )}
          <Toggle label="Full-travel rapid trigger" checked={ft === t.length}
            help={ft && ft < t.length ? `On for ${ft} of ${t.length} keys` : 'Active all the way to the top'}
            onChange={next => edit(x => (x.press ? withFullTravel(x, next) : x))} />
        </>
      )}

      <TravelGauge t={t} />

      <button type="button" onClick={() => edit(resetTravel)}
        className="justify-self-center rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40">
        Reset to default
      </button>
    </fieldset>
  )
}

// A slider plus a number box in mm. The number box is "uncontrolled": it keeps its own text while you type and
// commits on Enter or when you leave it. `key` forces React to recreate it when the value changes elsewhere.
export function MmField({ label, value, limit, help, warn, onChange, reset }: {
  label: string
  value: number | null
  limit: Limit
  help: string
  warn?: string | false // shown in red instead of the help lines (value at or below 0.04 mm)
  onChange: (v: number) => void
  reset?: () => void // shows a reset icon right of the number box
}) {
  const commit = (text: string) => {
    if (text.trim() === '') return
    onChange(clamp(parseFloat(text) * 100, limit))
  }
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={label} className="text-sm font-medium">{label}</label>
        <span className="flex items-baseline gap-1">
          <input
            id={label}
            key={value ?? 'mixed'}
            type="number"
            inputMode="decimal"
            step={0.01}
            min={limit.min / 100}
            max={limit.max / 100}
            defaultValue={value === null ? '' : mm(value)}
            placeholder="mixed"
            onBlur={e => commit(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value) }}
            className="w-16 rounded-md border border-line bg-cap px-1.5 py-0.5 text-right text-sm focus-visible:outline-2 focus-visible:outline-ink"
          />
          <span className="text-xs text-mute">mm</span>
          {reset && (
            <button type="button" onClick={reset} title={`Reset ${label.toLowerCase()} to ${mm(TRAVEL.defaultRt)} mm`}
              aria-label={`Reset ${label.toLowerCase()} to ${mm(TRAVEL.defaultRt)} mm`}
              className="self-center rounded-md p-0.5 text-mute hover:bg-cap hover:text-ink focus-visible:outline-2 focus-visible:outline-ink">
              <ResetIcon />
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        aria-label={`${label} slider`}
        min={limit.min}
        max={limit.max}
        step={1}
        value={value ?? limit.min}
        onChange={e => onChange(Number(e.currentTarget.value))}
        className={`mt-1 w-full accent-[var(--color-deep)] ${value === null ? 'opacity-50' : ''}`}
      />
      {/* The warning takes the help lines' place (kept at least two lines tall), so nothing moves while dragging. */}
      {warn ? (
        <p role="alert" className="min-h-[2lh] text-xs text-write"
          title={`${mm(TRAVEL.rtWarn)} mm or less isn’t recommended: slight finger movements may trigger the key.`}>
          {warn}
        </p>
      ) : (
        <p className="text-xs text-mute">{help}<br />{mm(limit.min)}–{mm(limit.max)} mm</p>
      )}
    </div>
  )
}

// Two arrows turning in a circle.
export function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3v5h5" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 21v-5h-5" />
    </svg>
  )
}

export function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-mute">{help}</div>
      </div>
      <Switch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40 ${
        checked ? 'bg-deep' : 'bg-line'
      }`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-cap shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  )
}

// Side view of the key's travel: 0 mm (key up) on the left, 4 mm (bottomed out) on the right. The blue mark is the
// actuation point; with rapid trigger, the orange bars show the release (top) and re-press (bottom) distances.
function TravelGauge({ t }: { t: KeyTravel[] }) {
  const MAX = 400, x = (v: number) => 20 + (v / MAX) * 280 // drawn at ~panel width so text stays ~12px
  const acts = t.map(k => k.actuation)
  const lo = Math.min(...acts), hi = Math.max(...acts)
  const one = t.every(k => k.actuation === t[0].actuation && k.press === t[0].press && k.release === t[0].release)
  const k = t[0]
  return (
    <svg viewBox="0 0 320 58" className="w-full" role="img"
      aria-label={`Key travel: actuates at ${mm(lo)}${lo === hi ? '' : `–${mm(hi)}`} mm of 4 mm`}>
      {[0, 1, 2, 3, 4].map(v => (
        <g key={v}>
          <text x={x(v * 100)} y={11} textAnchor="middle" fontSize={11} fill="var(--color-mute)">{v} mm</text>
          <line x1={x(v * 100)} x2={x(v * 100)} y1={15} y2={19} stroke="var(--color-mute)" />
        </g>
      ))}
      <rect x={x(0)} y={24} width={x(MAX) - x(0)} height={8} rx={2} fill="var(--color-shallow)" />
      <rect x={x(lo)} y={20} width={Math.max(3, x(hi) - x(lo))} height={16} rx={1} fill="var(--color-deep)" />
      {one && k.press > 0 && (
        <>
          <rect x={x(k.actuation) - (x(k.release) - x(0))} y={42} width={x(k.release) - x(0)} height={5} fill="var(--color-select)" />
          <rect x={x(k.actuation)} y={50} width={x(k.press) - x(0)} height={5} fill="var(--color-select)" opacity={0.55} />
        </>
      )}
    </svg>
  )
}
