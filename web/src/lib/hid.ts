// WebHID transport for the Epomaker HE80. Protocol: docs/TECHNICAL.md
// Framework-free: no React imports here.

export const VID = 0x0c45
export const PID = 0x8092
export const USAGE_PAGE = 0xff68
export const USAGE = 0x61

const REQUEST = 0xaa
const REPLY = 0x55
const HEADER = 8

// The only commands that can ever leave the app. Never add 0x0F (factory reset), 0x4F (flash download),
// 0x64/0x65 (calibration) or ISP commands. Writes are enabled one by one after a hardware test.
export const READS = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18])
export const WRITES = new Set([0x21, 0x22, 0x25, 0x26, 0x27, 0x28]) // settings, key map, macros, Fn layer, per-key RT, DKS slots

const le16 = (d: Uint8Array, i: number) => d[i] | (d[i + 1] << 8)

// Request header: AA cmd len offLo offHi 0 last 0, payload from byte 8 (zeros for reads).
export function buildPacket(packLen: number, cmd: number, off: number, len: number, last: boolean, payload?: Uint8Array) {
  const p = new Uint8Array(packLen)
  p.set([REQUEST, cmd, len, off & 0xff, off >> 8, 0, last ? 1 : 0, 0])
  if (payload) p.set(payload, HEADER)
  return p
}

export class Transport {
  readonly device: HIDDevice
  readonly packLen: number
  private readonly timeoutMs: number
  private readonly retries: number
  private queue: Promise<unknown> = Promise.resolve()

  constructor(device: HIDDevice, packLen = 64, timeoutMs = 1000, retries = 3) {
    this.device = device
    this.packLen = packLen
    this.timeoutMs = timeoutMs
    this.retries = retries
  }

  read(cmd: number, size: number): Promise<Uint8Array> {
    if (!READS.has(cmd)) return Promise.reject(new Error(`refusing read 0x${cmd.toString(16)}`))
    return this.run(() => this.transfer(cmd, new Uint8Array(size), false))
  }

  async write(cmd: number, bytes: Uint8Array): Promise<void> {
    if (!WRITES.has(cmd)) throw new Error(`refusing write 0x${cmd.toString(16)}`)
    await this.run(() => this.transfer(cmd, bytes, true))
  }

  // One command at a time: replies only carry cmd + offset, so overlapping transfers could steal each other's replies.
  private run<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job)
    this.queue = p.catch(() => {})
    return p
  }

  private async transfer(cmd: number, data: Uint8Array, write: boolean) {
    const chunk = this.packLen - HEADER
    const n = Math.ceil(data.length / chunk)
    const out = new Uint8Array(data.length)
    for (let i = 0; i < n; i++) {
      const off = i * chunk
      const part = data.subarray(off, off + chunk)
      const pkt = buildPacket(this.packLen, cmd, off, part.length, i === n - 1, write ? part : undefined)
      const reply = await this.exchange(pkt, cmd, off)
      if (!write) out.set(reply.subarray(HEADER, HEADER + part.length), off)
    }
    return out
  }

  // Send one packet and wait for its `55 cmd len off` reply (reads) or ack (writes), retrying on timeout.
  private async exchange(pkt: Uint8Array, cmd: number, off: number) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const reply = await this.once(pkt, cmd, off)
      if (reply) return reply
    }
    throw new Error(`no reply for 0x${cmd.toString(16)} at offset ${off}`)
  }

  private once(pkt: Uint8Array, cmd: number, off: number): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const done = (v: Uint8Array | null) => {
        clearTimeout(timer)
        this.device.removeEventListener('inputreport', onReport)
        resolve(v)
      }
      const onReport = (e: HIDInputReportEvent) => {
        const d = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)
        if (d[0] === REPLY && d[1] === cmd && le16(d, 3) === off) done(d.slice())
      }
      const timer = setTimeout(() => done(null), this.timeoutMs)
      this.device.addEventListener('inputreport', onReport)
      this.device.sendReport(0, pkt as Uint8Array<ArrayBuffer>).catch(err => {
        clearTimeout(timer)
        this.device.removeEventListener('inputreport', onReport)
        reject(err)
      })
    })
  }
}

const isHE80 = (d: HIDDevice) =>
  d.vendorId === VID && d.productId === PID && d.collections.some(c => c.usagePage === USAGE_PAGE)

async function open(d: HIDDevice) {
  if (!d.opened) await d.open()
  const col = d.collections.find(c => c.usagePage === USAGE_PAGE)
  return new Transport(d, col?.outputReports?.[0]?.items?.[0]?.reportCount ?? 64)
}

/** Shows the browser's device picker. Returns null if the user cancels. */
export async function requestKeyboard() {
  const [d] = await navigator.hid.requestDevice({
    filters: [{ vendorId: VID, productId: PID, usagePage: USAGE_PAGE, usage: USAGE }],
  })
  return d ? open(d) : null
}

/** Reopens a keyboard the user already granted, without a picker (e.g. after a page reload). */
export async function grantedKeyboard() {
  const d = (await navigator.hid.getDevices()).find(isHE80)
  return d ? open(d) : null
}

/** Calls `cb` when this keyboard is unplugged. Returns an unsubscribe function. */
export function onDisconnect(t: Transport, cb: () => void) {
  const h = (e: HIDConnectionEvent) => { if (e.device === t.device) cb() }
  navigator.hid.addEventListener('disconnect', h)
  return () => navigator.hid.removeEventListener('disconnect', h)
}
