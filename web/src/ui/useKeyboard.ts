// React hook: owns the connection and the raw regions read from the keyboard (or loaded from a backup file).
// A hook is a function whose name starts with "use"; it can hold state (useState) and run side effects (useEffect),
// and any component that calls it re-renders when that state changes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { grantedKeyboard, onDisconnect, requestKeyboard, type Transport } from '../lib/hid.ts'
import { downloadBackup, equal, fromJson, readAll, restore, saveAutoBackup, writeVerified, type Backup, type Regions, type WritableRegion } from '../lib/backup.ts'

export type Connection =
  | { kind: 'idle'; message?: string }
  | { kind: 'busy'; message: string }
  | { kind: 'device'; transport: Transport; regions: Regions }
  | { kind: 'file'; name: string; regions: Regions }

function explain(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  if (/open/i.test(msg)) return 'Couldn’t open the keyboard. Close the Epomaker hub and other driver tabs, then connect again.'
  return msg
}

export function useKeyboard() {
  const [conn, setConn] = useState<Connection>({ kind: 'idle' })
  // What the keyboard holds right now. Writes can be queued from timers created on earlier renders, so they read
  // this ref rather than the `conn` captured in their closure (which may be one write behind).
  const live = useRef<Regions | null>(null)
  // Safety net: every time the keyboard is read, keep a copy of what it holds (browser storage, last 5, repeats
  // skipped). Writes are refused if that failed, unless the user saved a backup file this session instead.
  const backedUp = useRef(false)

  const load = useCallback(async (transport: Transport) => {
    setConn({ kind: 'busy', message: 'Reading the keyboard…' })
    try {
      const regions = await readAll(transport)
      live.current = regions
      backedUp.current = saveAutoBackup(regions) || backedUp.current
      setConn({ kind: 'device', transport, regions })
    } catch (e) {
      setConn({ kind: 'idle', message: `Reading failed: ${explain(e)}` })
    }
  }, [])

  const connect = useCallback(async () => {
    if (!('hid' in navigator)) {
      setConn({ kind: 'idle', message: 'This browser can’t talk to USB keyboards. Open this page in Chrome or Edge on a computer.' })
      return
    }
    try {
      const t = await requestKeyboard()
      if (t) await load(t)
    } catch (e) {
      setConn({ kind: 'idle', message: explain(e) })
    }
  }, [load])

  const openFile = useCallback(async (file: File) => {
    try {
      setConn({ kind: 'file', name: file.name, regions: fromJson(await file.text()).regions })
    } catch (e) {
      setConn({ kind: 'idle', message: `${file.name}: ${explain(e)}` })
    }
  }, [])

  const close = useCallback(async () => {
    live.current = null
    if (conn.kind === 'device') await conn.transport.device.close().catch(() => {})
    setConn({ kind: 'idle' })
  }, [conn])

  const saveBackup = useCallback(() => {
    if (conn.kind === 'idle' || conn.kind === 'busy') return
    downloadBackup({ date: new Date().toISOString(), regions: conn.regions })
    backedUp.current = true
  }, [conn])

  /** Writes one region (read-check, write, read back), then updates the regions on screen. */
  const write = useCallback(async (name: WritableRegion, makeAfter: (before: Uint8Array) => Uint8Array) => {
    const regions = live.current
    if (conn.kind !== 'device' || !regions) throw new Error('Connect the keyboard to change settings.')
    const before = regions[name]
    if (!before) throw new Error(`No ${name} data was read from the keyboard.`)
    if (!backedUp.current) throw new Error('Couldn’t keep a safety backup in this browser. Save a backup file first (Backups), then change the setting again.')
    const after = makeAfter(before)
    if (equal(after, before)) return // nothing to change (e.g. a save step with no effect)
    await writeVerified(conn.transport, name, before, after)
    // Merge into the latest regions, not the snapshot above: another region's write (e.g. DKS slot + key map) may
    // have finished while this one was running, and spreading the old snapshot would undo it.
    if (live.current) live.current = { ...live.current, [name]: after } // null = disconnected meanwhile
    setConn(c => (c.kind === 'device' ? { ...c, regions: { ...c.regions, [name]: after } } : c))
  }, [conn])

  /** Writes every allowed region of `backup` that differs from the keyboard, then re-reads everything. */
  const restoreBackup = useCallback(async (backup: Backup) => {
    const regions = live.current
    if (conn.kind !== 'device' || !regions) throw new Error('Connect the keyboard to restore a backup.')
    if (!backedUp.current) throw new Error('Couldn’t keep a safety backup in this browser. Save a backup file first, then restore again.')
    try {
      return await restore(conn.transport, backup)
    } finally {
      // Re-read in place (not via load(), which would swap in the "Reading…" screen) so the screen shows what the
      // keyboard really has, even after a failed restore.
      const fresh = await readAll(conn.transport)
      live.current = fresh
      setConn(c => (c.kind === 'device' ? { ...c, regions: fresh } : c))
    }
  }, [conn])

  // Reconnect without the picker if the keyboard was granted before. The ref stops React's dev-mode double effect
  // from opening it twice.
  const tried = useRef(false)
  useEffect(() => {
    if (tried.current || !('hid' in navigator)) return
    tried.current = true
    grantedKeyboard().then(t => t && load(t)).catch(() => {})
  }, [load])

  // Drop back to the connect screen when the keyboard is unplugged.
  const transport = conn.kind === 'device' ? conn.transport : null
  useEffect(() => {
    if (!transport) return
    return onDisconnect(transport, () => {
      live.current = null
      setConn({ kind: 'idle', message: 'The keyboard was unplugged.' })
    })
  }, [transport])

  return { conn, connect, openFile, close, saveBackup, write, restoreBackup, reload: transport ? () => load(transport) : undefined }
}
