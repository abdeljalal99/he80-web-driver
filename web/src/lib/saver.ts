// "Save the latest value" queue for live editing. Each push restarts a short timer; when it fires, the newest value
// is saved. Values pushed while a save is running are saved right after it, and only the newest one: dragging a
// slider costs one or two writes, not one per step.

export type SaveState = 'saving' | 'saved' | Error

export function createSaver<T>(save: (v: T) => Promise<void>, delayMs: number, report: (s: SaveState) => void) {
  let pending: T | null = null
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = async () => {
    if (busy || pending === null) return
    busy = true
    report('saving')
    try {
      while (pending !== null) {
        const v = pending
        pending = null
        await save(v)
      }
      report('saved')
    } catch (e) {
      pending = null // drop queued edits: the screen goes back to what the keyboard really has
      report(e instanceof Error ? e : new Error(String(e)))
    } finally {
      busy = false
    }
  }

  return {
    push(v: T) {
      pending = v
      clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    /** The newest value not yet handed to `save`, if any. */
    get pending() { return pending },
  }
}

/** Overall status of several savers (one per editor): saving while any is busy, else the first error (an error stays
 *  until that saver succeeds again, so another region's "saved" can't hide it), else saved. */
export function combine(states: SaveState[]): SaveState | null {
  if (!states.length) return null
  if (states.includes('saving')) return 'saving'
  return states.find(s => s instanceof Error) ?? 'saved'
}
