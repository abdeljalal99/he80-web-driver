// The 82-key board. A component is a function that returns markup (JSX); its inputs are "props".
// Selection works like a file manager: a click selects just that key, Ctrl/Cmd/Shift+click adds or removes one key.
// Dragging paints a box (a box rather than "keys the pointer entered", so fast drags can't skip keys): a plain drag
// selects the keys in it; with Ctrl/Cmd/Shift it adds them, or removes them if the drag starts on a selected key.

import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'

interface Drag { x: number; y: number; base: Set<number>; add: boolean }
import { KEYS, ROWS, type Key } from '../lib/keys.ts'

// Cap face, laid out like the official hub: small value top-left, legend in the middle, small detail at the bottom.
export interface Cap {
  legend: string
  top?: string // e.g. actuation "0.10"
  bottom?: string // e.g. RT "↓0.10 ↑0.10" or the original key name
  depth?: number // 0–1: shades the cap from shallow to deep
  marked?: boolean // highlight (remapped / advanced key)
}

interface Props {
  cap: (k: Key) => Cap
  selected: Set<number>
  setSelected: Dispatch<SetStateAction<Set<number>>>
  disabled?: boolean
  locked?: Set<number> // keys that can't be changed in this view: greyed out, never selectable
}

export function Keyboard({ cap, selected, setSelected, disabled, locked }: Props) {
  // useRef holds values that change without re-rendering: the drag in progress and the board element.
  const drag = useRef<Drag | null>(null)
  const board = useRef<HTMLDivElement>(null)

  // Select the keys touched by the box from the drag start to (x, y), on top of the selection the drag started with.
  const update = (x: number, y: number) => {
    const d = drag.current
    if (!d || !board.current) return
    const [l, r, t, b] = [Math.min(d.x, x), Math.max(d.x, x), Math.min(d.y, y), Math.max(d.y, y)]
    const next = new Set(d.base)
    board.current.querySelectorAll<HTMLElement>('[data-key]').forEach(el => {
      const k = el.getBoundingClientRect()
      if (k.left <= r && k.right >= l && k.top <= b && k.bottom >= t) {
        const i = Number(el.dataset.key)
        if (locked?.has(i)) return
        if (d.add) next.add(i)
        else next.delete(i)
      }
    })
    setSelected(next)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => { if (e.buttons === 1) update(e.clientX, e.clientY) }
    const stop = () => { drag.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
  })

  const down = (e: React.PointerEvent<HTMLButtonElement>, index: number) => {
    if (disabled || locked?.has(index) || e.button !== 0) return
    e.currentTarget.releasePointerCapture(e.pointerId) // touch: keep getting moves after leaving the first key
    const more = e.ctrlKey || e.metaKey || e.shiftKey // extend the selection instead of replacing it
    drag.current = more
      ? { x: e.clientX, y: e.clientY, base: new Set(selected), add: !selected.has(index) }
      : { x: e.clientX, y: e.clientY, base: new Set(), add: true }
    update(e.clientX, e.clientY)
  }

  // Keyboard (Enter/Space) on a focused key: same rules as a click.
  const press = (e: React.MouseEvent, index: number) =>
    setSelected(prev => {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return new Set([index])
      const next = new Set(prev)
      if (!next.delete(index)) next.add(index)
      return next
    })

  return (
    // Size container: the board takes the largest size that fits both the width and the height it's given.
    <div className="@container-size size-full min-h-0 min-w-0">
      <div
        ref={board}
        role="group"
        aria-label="Keyboard"
        className="@container mx-auto select-none lg:ml-0 touch-none rounded-[14px] border border-line bg-plate p-[1.5%]"
        style={{ width: 'min(100cqw, 100cqh * 2.42)', boxShadow: 'inset 0 1px 0 rgb(255 255 255 / .35), 0 1px 2px rgb(0 0 0 / .08)' }}
      >
        {ROWS.map((row, r) => (
          <div key={r} className={`flex ${r === 1 ? 'mt-[1.2cqw]' : ''}`}>
            {row.map(k => {
              const c = cap(k)
              const on = selected.has(k.index)
              const deep = (c.depth ?? 0) > 0.55
              return (
                <div key={k.index} style={{ width: `${(k.w / 16) * 100}%`, marginLeft: `${(k.gap / 16) * 100}%` }} className="p-[0.18cqw]">
                  <button
                    type="button"
                    disabled={disabled || locked?.has(k.index)}
                    title={locked?.has(k.index) ? 'Can’t be changed here' : undefined}
                    aria-pressed={on}
                    aria-label={[k.label, c.legend !== k.label && c.legend, c.top, c.bottom].filter(Boolean).join(', ')}
                    data-key={k.index}
                    onPointerDown={e => down(e, k.index)}
                    onClick={e => { if (e.detail === 0) press(e, k.index) }} // detail 0 = Enter/Space, not a mouse click
                    className={`relative grid h-[5.85cqw] w-full grid-rows-[auto_1fr_auto] rounded-[0.5cqw] border-b-[0.35cqw] border-cap-edge px-[0.5cqw] py-[0.4cqw] font-stretch-[72%] leading-none outline-offset-2 focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40 ${
                      deep ? 'text-on-deep' : ''
                    } ${on ? 'ring-[0.3cqw] ring-select ring-inset' : ''}`}
                    style={{
                      background:
                        c.depth === undefined
                          ? 'var(--color-cap)'
                          : `color-mix(in oklab, var(--color-deep) ${Math.round(c.depth * 100)}%, var(--color-shallow))`,
                    }}
                  >
                    <span className="h-[max(10px,1.2cqw)] truncate text-left text-[max(10px,1.2cqw)] opacity-80">{c.top}</span>
                    {/* Long labels (e.g. "Volume up" on a 1u key) get a smaller font and up to two lines instead of "…". */}
                    <span className={`self-center text-center ${c.marked ? 'font-bold' : 'font-semibold'} ${
                      c.legend.length > 5 * k.w
                        ? 'line-clamp-2 text-[max(10px,1.3cqw)] leading-tight [overflow-wrap:anywhere]'
                        : 'truncate text-[max(12px,1.75cqw)]'
                    }`}>{c.legend}</span>
                    <span className="h-[max(10px,1.2cqw)] truncate text-center text-[max(10px,1.2cqw)] opacity-80">{c.bottom}</span>
                    {c.marked && <span aria-hidden className="absolute right-[0.6cqw] top-[0.6cqw] size-[0.6cqw] rounded-full bg-select" />}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// Quick selections, as in the official hub (its number-key preset also lists numpad keys the HE80 doesn't have).
const PRESETS: [string, number[]][] = [
  ['Select all', KEYS.map(k => k.index)],
  ['WASD', [34, 49, 50, 51]],
  ['Number keys', [17, 18, 19, 20, 21, 22, 23, 24, 25, 26]],
  ['Arrow keys', [88, 89, 90, 91]],
]

const HINTS = [
  ['Click', 'selects one key'],
  ['Ctrl+click', 'adds or removes one key'],
  ['Drag', 'selects every key in the area (hold Ctrl to add them)'],
]

export function Presets({ selected, setSelected, locked }: Pick<Props, 'selected' | 'setSelected' | 'locked'>) {
  const btn = 'whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'
  return (
    <div role="group" aria-label="Quick select" className="flex flex-wrap justify-center gap-1.5">
      {PRESETS.map(([name, all]) => {
        const keys = all.filter(k => !locked?.has(k))
        const active = selected.size === keys.length && keys.every(k => selected.has(k))
        return (
          <button key={name} type="button" aria-pressed={active} disabled={!keys.length} onClick={() => setSelected(new Set(keys))}
            className={`${btn} ${active ? 'border-select bg-cap' : ''}`}>
            {name}
          </button>
        )
      })}
      <button type="button" className={btn} disabled={!selected.size} onClick={() => setSelected(new Set())}>
        Clear selection
      </button>
      <dl className="grid basis-full grid-cols-[auto_auto] justify-center gap-x-3 pt-1 text-sm">
        {HINTS.map(([how, what]) => (
          <div key={how} className="contents"><dt className="text-right font-medium">{how}</dt><dd className="text-mute">{what}</dd></div>
        ))}
      </dl>
    </div>
  )
}
