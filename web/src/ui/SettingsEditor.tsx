// Keyboard-wide settings (region 0x11/0x21). Saved automatically like the other tabs; the encoder only touches the
// fields shown here and writes every other byte back exactly as read.

import { useState } from 'react'
import { POLLING_RATES, type Settings } from '../lib/protocol.ts'
import { Toggle } from './TravelEditor.tsx'
import { mm } from '../lib/describe.ts'

export function SettingsEditor({ settings, edit, locked, saveBackup, resetAll }: {
  settings: Settings
  edit: (change: (s: Settings) => Settings) => void
  locked?: string
  saveBackup: () => void
  resetAll: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const deadZones = settings.topDeadZone > 0 || settings.bottomDeadZone > 0
  return (
    <fieldset disabled={!!locked} className="grid gap-5">
      {locked && <p className="text-sm text-mute">{locked}</p>}

      <div>
        <div className="text-sm font-medium">Polling rate</div>
        <div className="text-xs text-mute">How often the keyboard reports to the computer. Higher is faster but uses more CPU.</div>
        <div role="radiogroup" aria-label="Polling rate" className="mt-2 flex flex-wrap gap-1.5">
          {POLLING_RATES.map(hz => (
            <button key={hz} type="button" role="radio" aria-checked={settings.pollingRate === hz}
              onClick={() => edit(s => ({ ...s, pollingRate: hz }))}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink disabled:opacity-40 ${
                settings.pollingRate === hz ? 'border-select bg-cap' : 'border-line'
              }`}>
              {hz} Hz
            </button>
          ))}
        </div>
      </div>

      {/* Dead zones (bytes 8/9) aren't offered: no visible effect on firmware 1.08 and the official driver doesn't show
          them. Only leftover values (from the old hub or earlier versions of this driver) can be cleared here. */}
      {deadZones && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
          <span className="text-mute">Dead zones are set ({mm(settings.topDeadZone)} / {mm(settings.bottomDeadZone)} mm), probably by an older driver.</span>
          <button type="button" onClick={() => edit(s => ({ ...s, topDeadZone: 0, bottomDeadZone: 0 }))}
            className="shrink-0 rounded-md border border-line px-3 py-1.5 font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
            Reset to 0
          </button>
        </div>
      )}

      <Toggle label="Stability mode" checked={settings.stability} help="Filters sensor noise"
        onChange={on => edit(s => ({ ...s, stability: on }))} />
      <Toggle label="Adaptive calibration" checked={settings.adaptiveCalibration} help="Keeps recalibrating the switches while you type"
        onChange={on => edit(s => ({ ...s, adaptiveCalibration: on }))} />

      <div className="grid gap-2 border-t border-line pt-5">
        <div>
          <div className="text-sm font-medium">Reset keyboard</div>
          <div className="text-xs text-mute">
            Puts every key, the Fn layer, actuation and rapid trigger, advanced keys and macros back to defaults.
            Calibration and the settings above are kept.
          </div>
        </div>
        {confirm ? (
          <div className="grid gap-2 rounded-md border border-write p-3 text-sm">
            <p><b className="font-medium">Reset everything to defaults?</b> Save a backup first if you may want this setup back.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveBackup}
                className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
                Save backup file
              </button>
              <button type="button" onClick={() => { resetAll(); setConfirm(false) }}
                className="rounded-md bg-write px-3 py-1.5 font-medium text-plate focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                Reset everything
              </button>
              <button type="button" onClick={() => setConfirm(false)}
                className="rounded-md border border-line px-3 py-1.5 font-medium hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirm(true)}
            className="justify-self-start rounded-md border border-line px-3 py-1.5 text-sm font-medium text-write hover:bg-cap focus-visible:outline-2 focus-visible:outline-ink">
            Reset to defaults
          </button>
        )}
      </div>
    </fieldset>
  )
}
