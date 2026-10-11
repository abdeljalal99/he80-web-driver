import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { useKeyboard, type Connection } from './ui/useKeyboard.ts'
import { Keyboard, Presets, type Cap } from './ui/Keyboard.tsx'
import { TravelEditor } from './ui/TravelEditor.tsx'
import { BackupDialog } from './ui/BackupDialog.tsx'
import { SettingsEditor } from './ui/SettingsEditor.tsx'
import type { Backup, Regions, RestoreReport, WritableRegion } from './lib/backup.ts'
import { describeAction, isAdvanced, mm } from './lib/describe.ts'
import { decodeDks, decodeInfo, decodeKeymap, decodeMacros, decodeRt, decodeSettings, encodeKeymap, encodeMacros, encodeRt, encodeSettings, resetTravel, type KeyAction, type KeyTravel, type Macro, type Settings } from './lib/protocol.ts'
import { KEYS, type Key } from './lib/keys.ts'
import { combine, type SaveState } from './lib/saver.ts'
import { useLive, useLiveRegion } from './ui/useLiveRegion.ts'
import { saveBoard, tidy, type Board } from './lib/advanced.ts'
import { KeyPicker, FN_KEY } from './ui/KeyPicker.tsx'
import { AdvancedEditor } from './ui/AdvancedEditor.tsx'
import { ThemeSwitch } from './ui/theme.tsx'
import { MacroEditor } from './ui/MacroEditor.tsx'
import { FN_BUILT_IN, FN_FIXED } from './lib/fnDefaults.ts'

const TABS = ['Actuation & RT', 'Key map', 'Fn layer', 'Advanced', 'Macros', 'Settings'] as const
type Tab = (typeof TABS)[number]

// Bottom line of a cap: "RT 0.10" when press = release, else "↓.30 ↑.50" (short enough for a 1u key).
const rtLabel = (press: number, release: number) =>
  !press ? undefined : press === release ? `RT ${mm(press)}` : `↓${mm(press).replace(/^0/, "")} ↑${mm(release).replace(/^0/, "")}`

// Actuation range on the HE80 (hub config): 0.10–3.30 mm → depth 0–1.
const depthOf = (actuation: number) => Math.min(1, Math.max(0, (actuation - 10) / 320))

export default function App() {
  const kb = useKeyboard()
  return kb.conn.kind === 'device' || kb.conn.kind === 'file' ? (
    <Workspace conn={kb.conn} regions={kb.conn.regions} close={kb.close} reload={kb.reload} saveBackup={kb.saveBackup} write={kb.write} restoreBackup={kb.restoreBackup} />
  ) : (
    <ConnectScreen conn={kb.conn} connect={kb.connect} openFile={kb.openFile} />
  )
}

function ConnectScreen({ conn, connect, openFile }: {
  conn: Connection
  connect: () => void
  openFile: (f: File) => void
}) {
  const busy = conn.kind === 'busy'
  return (
    <main className="mx-auto flex h-dvh max-w-6xl flex-col px-4 py-8">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-none font-stretch-[80%]">EPOMAKER HE80</h1>
        <ThemeSwitch />
      </div>
      <p className="mt-3 max-w-[60ch] text-mute">
        Tune actuation, rapid trigger and key mapping on your Epomaker HE80. Use Chrome or Edge, and close the Epomaker hub
        first: only one app can talk to the keyboard at a time.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="rounded-lg bg-ink px-5 py-2.5 font-semibold text-plate focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
        >
          {busy ? conn.message : 'Connect keyboard'}
        </button>
        <label className="cursor-pointer rounded-lg border border-line px-5 py-2.5 font-medium focus-within:outline-2 focus-within:outline-ink">
          Open backup file
          <input type="file" accept=".json,application/json" className="sr-only" onChange={e => e.target.files?.[0] && openFile(e.target.files[0])} />
        </label>
      </div>
      {conn.kind === 'idle' && conn.message && <p role="alert" className="mt-4 max-w-[60ch] text-write">{conn.message}</p>}
      <div className="mt-8 min-h-0 flex-1 opacity-50" aria-hidden>
        <Keyboard cap={k => ({ legend: k.label })} selected={new Set()} setSelected={() => {}} disabled />
      </div>
    </main>
  )
}

type Status = { kind: 'idle' } | { kind: 'busy' | 'done' | 'error'; message: string }

function Workspace({ conn, regions, close, reload, saveBackup, write, restoreBackup }: {
  conn: Extract<Connection, { kind: 'device' | 'file' }>
  regions: Regions
  close: () => void
  reload?: () => void
  saveBackup: () => void
  write: (name: WritableRegion, makeAfter: (before: Uint8Array) => Uint8Array) => Promise<void>
  restoreBackup: (b: Backup) => Promise<RestoreReport>
}) {
  const [backups, setBackups] = useState(false)
  const [tab, setTab] = useState<Tab>('Actuation & RT')
  // Each tab keeps its own selection, so selecting keys to remap doesn't carry over to rapid trigger and back.
  const [selections, setSelections] = useState<Partial<Record<Tab, Set<number>>>>({})
  const selected = selections[tab] ?? new Set<number>()
  const setSelected = (u: SetStateAction<Set<number>>) =>
    setSelections(prev => {
      const cur = prev[tab] ?? new Set<number>()
      return { ...prev, [tab]: typeof u === 'function' ? u(cur) : u }
    })
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // useMemo: decode only when the raw bytes change, not on every render.
  const d = useMemo(() => ({
    info: regions.info && decodeInfo(regions.info),
    settings: regions.settings && decodeSettings(regions.settings),
    rt: regions.rt && decodeRt(regions.rt),
    keymap: regions.keymap && decodeKeymap(regions.keymap),
    fn: regions.fnLayer && decodeKeymap(regions.fnLayer),
    dks: regions.dks && decodeDks(regions.dks),
  }), [regions])

  // Each editor reports its own save state; the status line shows them combined, so an error in one region isn't
  // replaced by another region's "saved" (lib/saver.ts combine). The ref keeps them across renders without re-rendering.
  const saveStates = useRef(new Map<string, SaveState>())
  const reporter = (editor: string) => (st: SaveState) => {
    saveStates.current.set(editor, st)
    const all = combine([...saveStates.current.values()])
    setStatus(all === 'saving' ? { kind: 'busy', message: 'Saving to the keyboard…' }
      : all === 'saved' ? { kind: 'done', message: 'Saved to the keyboard.' }
      : all ? { kind: 'error', message: all.message } : { kind: 'idle' })
  }
  const rtEd = useLiveRegion<KeyTravel>('rt', d.rt, encodeRt, write, reporter('rt'))
  // Key map and DKS slots are edited and saved as one board, so the cross-key rules (lib/advanced.ts) always hold.
  const savedBoard = useMemo(() => (d.keymap && d.dks ? { keymap: d.keymap, dks: d.dks } : undefined), [d.keymap, d.dks])
  const boardEd = useLive<Board>(savedBoard, b => saveBoard(write, b), reporter('board'))
  const editBoard = (change: (b: Board) => Board) => boardEd.edit(b => tidy(b, change(b)))
  const fnEd = useLiveRegion<KeyAction>('fnLayer', d.fn, encodeKeymap, write, reporter('fnLayer'))
  const fnLayer = fnEd.values
  const savedMacros = useMemo(() => regions.macros && decodeMacros(regions.macros), [regions.macros])
  const macroEd = useLive<Macro[]>(savedMacros, m => write('macros', () => encodeMacros(m)), reporter('macros'))
  // Settings are one record, kept as a one-item list so the same live-editing hook works for them.
  const savedSettings = useMemo(() => (d.settings ? [d.settings] : undefined), [d.settings])
  const stEd = useLiveRegion<Settings>('settings', savedSettings, (before, [st]) => encodeSettings(before, st), write, reporter('settings'))
  const rt = rtEd.values
  const keymap = boardEd.value?.keymap
  const changed = new Set(rt && d.rt ? KEYS.filter(k => !sameTravel(rt[k.index], d.rt![k.index])).map(k => k.index) : [])

  const locked =
    conn.kind === 'file' ? 'You’re viewing a backup file. Connect the keyboard to change values.'
    : d.info && !d.info.known ? 'Editing is off: this isn’t a known HE80.'
    : d.info && d.info.rtPrecision !== 0 ? 'Editing is off: this keyboard uses a different travel precision.'
    : undefined

  const editRt = (change: (t: KeyTravel) => KeyTravel) => rtEd.edit(selected, change)
  // Reset to defaults with ordinary writes (never the factory-reset command 0x0F): keys, Fn layer, travel, advanced
  // keys/DKS and macros. Locked keys keep their entries (Fn on both layers, F1–F12 on the Fn layer); calibration and
  // the Settings-tab values are kept.
  const resetAll = () => {
    editBoard(b => ({ keymap: b.keymap.map((a, i) => (i === FN_KEY ? a : { type: 'default' })), dks: b.dks.map(() => null) }))
    fnEd.edit(new Set(ALL_KEYS.filter(i => !FN_LOCKED.has(i))), () => ({ type: 'default' }))
    rtEd.edit(new Set(ALL_KEYS), resetTravel)
    macroEd.edit(m => m.map(() => null))
  }
  // Keys that can't be changed in the current tab: Fn on both key layers (our rule: without it the Fn layer is
  // unreachable), plus F1–F12 on the Fn layer (both official hubs mark their Fn functions read-only).
  const lockedKeys = tab === 'Fn layer' ? FN_LOCKED : tab === 'Key map' || tab === 'Advanced' ? new Set([FN_KEY]) : undefined
  const notFn = () => new Set([...selected].filter(i => i !== FN_KEY))
  const pickKey = (a: KeyAction) => {
    const targets = notFn()
    editBoard(b => ({ ...b, keymap: b.keymap.map((old, i) => (targets.has(i) ? a : old)) }))
  }
  const pickFn = (a: KeyAction) => fnEd.edit(new Set([...notFn()].filter(i => !FN_FIXED.has(i))), () => a)

  // Warn before closing the tab while values are still being saved.
  const unsaved = status.kind === 'busy' || rt !== d.rt || boardEd.value !== savedBoard || fnLayer !== d.fn || macroEd.value !== savedMacros || stEd.values !== savedSettings
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const cap = (k: Key): Cap => {
    if (tab === 'Actuation & RT' && rt) {
      const t = rt[k.index]
      return { legend: k.label, top: mm(t.actuation), bottom: rtLabel(t.press, t.release), depth: depthOf(t.actuation), marked: changed.has(k.index) }
    }
    const a = keymap?.[k.index]
    if (tab === 'Key map' && a && a.type !== 'default' && !isAdvanced(a)) return { legend: describeAction(a).short, bottom: k.label, marked: true }
    const f = fnLayer?.[k.index]
    // Fn layer: show only what Fn + key does (custom ones marked), not the key's own name.
    if (tab === 'Fn layer' && f && f.type !== 'default') return { legend: describeAction(f).short, marked: true }
    if (tab === 'Fn layer' && FN_BUILT_IN[k.index]) return { legend: FN_BUILT_IN[k.index].short }
    if (tab === 'Advanced' && a && isAdvanced(a)) return { legend: describeAction(a).short, bottom: k.label, marked: true }
    return { legend: k.label }
  }

  const sel = [...selected].sort((a, b) => a - b)

  return (
    <div className="mx-auto flex h-dvh max-w-[1920px] flex-col overflow-hidden px-4 pb-4">
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-line py-3">
        <h1 className="text-2xl font-semibold font-stretch-[80%]">EPOMAKER HE80</h1>
        {d.info && <span className="text-mute">Firmware {d.info.firmware}</span>}
        {d.settings && <span className="text-mute">{d.settings.pollingRate} Hz</span>}
        {conn.kind === 'file' && <span className="text-mute">Viewing {conn.name}, keyboard not connected</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ThemeSwitch />
          <HeaderButton onClick={() => setBackups(true)}>Backups</HeaderButton>
          {reload && <HeaderButton onClick={reload}>Read again</HeaderButton>}
          <HeaderButton onClick={close}>{conn.kind === 'device' ? 'Disconnect' : 'Close file'}</HeaderButton>
        </div>
      </header>

      {d.info && !d.info.known && (
        <p role="alert" className="mt-3 shrink-0 text-write">
          This keyboard reports product number {d.info.productNum}, which isn’t a known HE80. Values may be wrong; don’t change anything.
        </p>
      )}

      {/* Tabs and content share one centred block (keyboard 900 px + gap + panel 380 px), so the tabs start where the keyboard starts. */}
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col lg:max-w-[1296px]">
        <nav role="tablist" aria-label="Sections" className="mt-3 flex shrink-0 gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-ink ${
                tab === t ? 'bg-ink text-plate' : 'text-mute hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === 'Macros' ? (
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 pb-1">
            {macroEd.value
              ? <MacroEditor macros={macroEd.value} keymap={keymap} fnLayer={fnLayer} edit={macroEd.edit} locked={locked} unassign={slot => {
                  const plays = (a: KeyAction) => a.type === 'macro' && a.index === slot
                  editBoard(b => ({ ...b, keymap: b.keymap.map(a => (plays(a) ? { type: 'default' } : a)) }))
                  if (fnLayer) fnEd.edit(new Set(fnLayer.flatMap((a, i) => (plays(a) ? [i] : []))), () => ({ type: 'default' }))
                }} />
              : <p className="text-mute">No macros in this backup.</p>}
            {status.kind !== 'idle' && (
              <p role={status.kind === 'error' ? 'alert' : 'status'} className={`shrink-0 text-sm ${status.kind === 'error' ? 'text-write' : 'text-mute'}`}>
                {status.message}
              </p>
            )}
          </div>
        ) : tab === 'Settings' ? (
          <section className="mt-4 min-h-0 w-full max-w-xl flex-1 overflow-y-auto pb-4 [scrollbar-gutter:stable]">
            {stEd.values ? (
              <SettingsEditor settings={stEd.values[0]} locked={locked} saveBackup={saveBackup} resetAll={resetAll}
                edit={change => stEd.edit(new Set([0]), change)} />
            ) : (
              <p className="text-mute">No settings in this backup.</p>
            )}
            {status.kind !== 'idle' && (
              <p role={status.kind === 'error' ? 'alert' : 'status'}
                className={`mt-5 border-t border-line pt-3 text-sm ${status.kind === 'error' ? 'text-write' : 'text-mute'}`}>
                {status.message}
              </p>
            )}
          </section>
        ) : (
          // Wide screens: keyboard left, settings panel right. Narrow screens: panel under the keyboard.
          <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start">
            {/* Keyboard column: the board keeps its shape and only shrinks when the window is short; quick-select below it. */}
            <div className="flex min-h-0 shrink flex-col gap-3 lg:max-h-full lg:min-w-0 lg:max-w-[900px] lg:flex-1">
              <div className="aspect-[2.45] min-h-0 shrink">
                <Keyboard cap={cap} selected={selected} setSelected={setSelected} locked={lockedKeys} />
              </div>
              <Presets selected={selected} setSelected={setSelected} locked={lockedKeys} />
            </div>
            <aside className="flex min-h-0 shrink-0 flex-col gap-4 overflow-y-auto [scrollbar-gutter:stable] rounded-xl border border-line p-4 lg:max-h-full lg:w-[380px]" aria-live="polite">
              {tab === 'Actuation & RT' && rt && <TravelEditor selected={sel} rt={rt} edit={editRt} locked={locked} />}
              {tab === 'Key map' && keymap && fnLayer && <KeyPicker layer="base" selected={sel} keymap={keymap} other={fnLayer} macros={macroEd.value} pick={pickKey} locked={locked} />}
              {tab === 'Fn layer' && keymap && fnLayer && <KeyPicker layer="fn" selected={sel} keymap={fnLayer} other={keymap} pick={pickFn} locked={locked} />}
              {tab === 'Advanced' && boardEd.value && (
                <AdvancedEditor selected={sel.filter(i => i !== FN_KEY)} board={boardEd.value} edit={editBoard} locked={locked} />
              )}
              {status.kind !== 'idle' && (
                <p role={status.kind === 'error' ? 'alert' : 'status'}
                  className={`mt-auto border-t border-line pt-3 text-sm ${status.kind === 'error' ? 'text-write' : 'text-mute'}`}>
                  {status.message}
                </p>
              )}
            </aside>
          </div>
        )}
      </div>
      <BackupDialog open={backups} onClose={() => setBackups(false)} current={regions} save={saveBackup}
        restore={conn.kind === 'device' ? restoreBackup : undefined} />
    </div>
  )
}

const FN_LOCKED = new Set([FN_KEY, ...FN_FIXED])
const ALL_KEYS = Array.from({ length: 128 }, (_, i) => i) // every entry of a per-key table

const sameTravel = (a: KeyTravel, b: KeyTravel) =>
  a.switchType === b.switchType && a.flags === b.flags && a.actuation === b.actuation && a.press === b.press && a.release === b.release

function HeaderButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
      {children}
    </button>
  )
}

