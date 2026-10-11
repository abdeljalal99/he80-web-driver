import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Transport, buildPacket } from './hid.ts'

// Fake HE80: answers like the real board (55 cmd len off… + payload), stores writes (0x2X) as region 0x1X.
class FakeKeyboard extends EventTarget {
  sent: Uint8Array[] = []
  mem = new Map<number, Uint8Array>()
  drop = 0 // swallow this many requests without replying
  noise = false // send an unrelated report before each real reply

  async sendReport(_id: number, data: Uint8Array) {
    const p = Uint8Array.from(data)
    this.sent.push(p)
    if (this.drop > 0) { this.drop--; return }
    const [, cmd, len, lo, hi] = p
    const off = lo | (hi << 8)
    const reply = new Uint8Array(p.length)
    reply.set(p.subarray(0, 8))
    reply[0] = 0x55
    if (cmd >= 0x20) {
      const region = this.mem.get(cmd - 0x10)!
      region.set(p.subarray(8, 8 + len), off)
    } else {
      reply.set(this.mem.get(cmd)!.subarray(off, off + len), 8)
    }
    setTimeout(() => {
      if (this.noise) this.emit(Uint8Array.from([0x55, cmd, len, (off + 56) & 0xff, (off + 56) >> 8])) // wrong offset
      this.emit(reply)
    })
  }

  emit(d: Uint8Array) {
    const e = new Event('inputreport')
    Object.assign(e, { data: new DataView(d.buffer) })
    this.dispatchEvent(e)
  }
}

const setup = () => {
  const kb = new FakeKeyboard()
  const rt = Uint8Array.from({ length: 1024 }, (_, i) => i * 7)
  kb.mem.set(0x17, rt)
  kb.mem.set(0x10, Uint8Array.from({ length: 56 }, (_, i) => i))
  const t = new Transport(kb as unknown as HIDDevice, 64, 20, 3)
  return { kb, t, rt }
}

test('packet header matches AA cmd len offLo offHi 0 last 0', () => {
  const p = buildPacket(64, 0x27, 0x3f0, 16, true, Uint8Array.of(9, 9))
  assert.deepEqual([...p.subarray(0, 10)], [0xaa, 0x27, 16, 0xf0, 0x03, 0, 1, 0, 9, 9])
  assert.equal(p.length, 64)
})

test('1024-byte read = 19 packets, last flag only on the last, data reassembled', async () => {
  const { kb, t, rt } = setup()
  const got = await t.read(0x17, 1024)
  assert.deepEqual(got, rt)
  assert.equal(kb.sent.length, 19)
  assert.deepEqual(kb.sent.map(p => p[6]), [...Array(18).fill(0), 1])
  assert.deepEqual(kb.sent.map(p => p[3] | (p[4] << 8)), Array.from({ length: 19 }, (_, i) => i * 56))
  assert.equal(kb.sent[18][2], 1024 - 18 * 56)
  assert.ok(kb.sent.every(p => p.subarray(8).every(b => b === 0)), 'reads send zero payload')
})

test('write sends payload in chunks and the board stores it', async () => {
  const { kb, t } = setup()
  const next = Uint8Array.from({ length: 1024 }, (_, i) => 255 - (i & 255))
  await t.write(0x27, next)
  assert.deepEqual(kb.mem.get(0x17), next)
  assert.equal(kb.sent.length, 19)
})

test('ignores replies with the wrong offset', async () => {
  const { kb, t, rt } = setup()
  kb.noise = true
  assert.deepEqual(await t.read(0x17, 1024), rt)
})

test('retries a lost reply, gives up after 3 retries', async () => {
  const { kb, t } = setup()
  kb.drop = 3
  assert.equal((await t.read(0x10, 56)).length, 56)
  assert.equal(kb.sent.length, 4)
  kb.drop = 4
  await assert.rejects(t.read(0x10, 56), /no reply for 0x10 at offset 0/)
})

test('allowlist refuses anything not explicitly enabled', async () => {
  const { kb, t } = setup()
  for (const cmd of [0x0f, 0x4f, 0x64, 0x65, 0x23]) await assert.rejects(t.write(cmd, new Uint8Array(8)), /refusing/)
  await assert.rejects(t.read(0x22, 8), /refusing/)
  assert.equal(kb.sent.length, 0)
})

test('concurrent calls are queued, never interleaved', async () => {
  const { kb, t, rt } = setup()
  const [a, b] = await Promise.all([t.read(0x17, 1024), t.read(0x10, 56)])
  assert.deepEqual(a, rt)
  assert.equal(b[5], 5)
  assert.deepEqual(kb.sent.map(p => p[1]), [...Array(19).fill(0x17), 0x10])
})
