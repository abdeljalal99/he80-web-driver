// Backups window: save the keyboard's current setup to a file, or restore one (a file or an automatic safety backup)
// after seeing exactly what would change. Uses the browser's own <dialog> element (focus trapping, Esc to close and
// the backdrop come for free).

import { useEffect, useRef, useState } from 'react'
import { fromJson, listAutoBackups, type Backup, type Regions, type RestoreReport } from '../lib/backup.ts'
import { diffRegions } from '../lib/diff.ts'

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso || 'unknown date' : d.toLocaleString()
}

export function BackupDialog({ open, onClose, current, save, restore }: {
  open: boolean
  onClose: () => void
  current: Regions
  save: () => void
  restore?: (b: Backup) => Promise<RestoreReport> // only when the keyboard is connected
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [chosen, setChosen] = useState<{ name: string; backup: Backup } | null>(null)
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'busy' } | { kind: 'done' | 'error'; message: string }>({ kind: 'idle' })

  // Open/close the native dialog when `open` changes; reset it each time it opens.
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      setChosen(null)
      setState({ kind: 'idle' })
      d.showModal()
    }
    if (!open && d.open) d.close()
  }, [open])

  const autos = open ? listAutoBackups() : []
  const groups = chosen ? diffRegions(current, chosen.backup.regions) : []
  const allowed = groups.filter(g => g.allowed)
  const count = allowed.length // sections that will be written

  const pickFile = async (file: File) => {
    try {
      setChosen({ name: file.name, backup: fromJson(await file.text()) })
      setState({ kind: 'idle' })
    } catch (e) {
      setChosen(null)
      setState({ kind: 'error', message: `${file.name}: ${e instanceof Error ? e.message : e}` })
    }
  }

  const run = async () => {
    if (!chosen || !restore) return
    setState({ kind: 'busy' })
    try {
      const r = await restore(chosen.backup)
      setState({ kind: 'done', message: r.written.length ? `Restored. The keyboard now matches the backup${r.notAllowed.length ? ', except the sections that can’t be restored yet' : ''}.` : 'Nothing needed restoring.' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const btn = 'rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40'

  return (
    <dialog ref={ref} onClose={onClose}
      className="m-auto max-h-[85dvh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-plate p-0 text-ink backdrop:bg-black/50">
      <div className="flex max-h-[85dvh] flex-col">
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Backups</h2>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-gutter:stable]">
          <section>
            <h3 className="text-base font-semibold">Save</h3>
            <p className="mt-1 text-sm text-mute">Download everything the keyboard holds now as a .json file. The keyboard has no profile slots, so these files are your profiles too.</p>
            <button type="button" className={`${btn} mt-2`} onClick={save}>Save backup file</button>
          </section>

          {restore && (
            <section className="mt-6 border-t border-line pt-5">
              <h3 className="text-base font-semibold">Restore</h3>
              <p className="mt-1 text-sm text-mute">Pick a backup to see what would change. Nothing is written until you confirm.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className={`${btn} cursor-pointer focus-within:outline-2 focus-within:outline-ink`}>
                  Open backup file
                  <input type="file" accept=".json,application/json" className="sr-only"
                    onChange={e => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) pickFile(f) }} />
                </label>
                {autos.length > 0 && (
                  <select aria-label="Automatic safety backups" value=""
                    onChange={e => { const b = autos[Number(e.currentTarget.value)]; if (b) { setChosen({ name: `Safety backup from ${when(b.date)}`, backup: b }); setState({ kind: 'idle' }) } }}
                    className="rounded-md border border-line bg-cap px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ink">
                    <option value="" disabled>Or pick a safety backup…</option>
                    {autos.map((b, i) => <option key={i} value={i}>{when(b.date)}</option>)}
                  </select>
                )}
              </div>

              {chosen && (
                <div className="mt-4">
                  <p className="font-medium">{chosen.name}</p>
                  {groups.length === 0 ? (
                    <p className="mt-1 text-sm text-mute">This backup matches the keyboard. Nothing to restore.</p>
                  ) : (
                    groups.map(g => (
                      <div key={g.region} className="mt-4">
                        <h4 className="text-base font-semibold">
                          {g.title}
                          {!g.allowed && <span className="ml-2 font-normal text-mute">can’t be restored yet</span>}
                        </h4>
                        <ul className={`mt-1 text-sm ${g.allowed ? '' : 'text-mute'}`}>
                          {g.lines.slice(0, 40).map((l, i) => <li key={i} className="border-b border-line py-1 last:border-0">{l}</li>)}
                          {g.lines.length > 40 && <li className="py-1 text-mute">and {g.lines.length - 40} more</li>}
                        </ul>
                      </div>
                    ))
                  )}
                </div>
              )}
            </section>
          )}

          {state.kind !== 'idle' && (
            <p role={state.kind === 'error' ? 'alert' : 'status'} className={`mt-4 text-sm ${state.kind === 'error' ? 'text-write' : 'text-mute'}`}>
              {state.kind === 'busy' ? 'Restoring…' : state.message}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className={btn} onClick={onClose} disabled={state.kind === 'busy'}>
            {state.kind === 'done' || !chosen ? 'Close' : 'Cancel'}
          </button>
          {restore && state.kind !== 'done' && (
            <button type="button" onClick={run} disabled={!count || state.kind === 'busy'}
              className="rounded-md bg-write px-3 py-1.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40">
              Restore these changes
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
