import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as m from './macros.ts'
import { decodeMacros, encodeMacros, type Macro } from './protocol.ts'

test('macro steps: hub flags, last wait 0, waits clamped, empty = unused slot', () => {
  const steps = [m.keyEvent(4, true, 2), m.keyEvent(4, false, 999999)]
  assert.deepEqual(steps.map(e => e.flags), [0xb0, 0x30])
  assert.deepEqual(m.normalize(steps)!.map(e => e.delay), [5, 0]) // min 5, last forced to 0
  assert.deepEqual(m.normalize([steps[1], steps[0]].map(e => ({ ...e, delay: 0 })))!.map(e => e.delay), [20, 0]) // moved-up end step
  assert.equal(m.normalize([]), null)
  assert.deepEqual(m.withPress(steps[1], true).flags, 0xb0)
  assert.deepEqual(m.withPress({ delay: 0, code: 1, flags: 0x90 }, false).flags, 0x10) // mouse keeps its type
})

test('macro storage: 624 bytes after the table, header + 4 bytes per step', () => {
  const one: Macro = [m.keyEvent(4, true, 20), m.keyEvent(4, false, 0)]
  assert.deepEqual(m.usage([one, null, one]), { used: 24, total: 624 })
  const big = Array.from({ length: 155 }, () => m.keyEvent(4, true, 5)) // 4 + 155 × 4 = 624
  assert.ok(m.fits([big]))
  assert.ok(!m.fits([big, one]))
  assert.deepEqual(decodeMacros(encodeMacros([big]))[0], big) // the largest macro that fits really encodes
})

test('keys left pressed', () => {
  assert.deepEqual(m.leftPressed([m.keyEvent(225, true, 5), m.keyEvent(4, true, 5), m.keyEvent(4, false, 0)]), [225])
  assert.deepEqual(m.leftPressed([{ delay: 0, code: 1, flags: 0x90 }]), []) // mouse buttons aren't tracked
})

test('recording: browser key codes → HID usages', () => {
  assert.deepEqual(['KeyA', 'KeyZ', 'Digit1', 'Digit0', 'F1', 'F12', 'F13', 'Numpad1', 'Numpad0', 'ControlLeft', 'MetaRight', 'Space'].map(m.usageOf),
    [4, 29, 30, 39, 58, 69, 104, 89, 98, 224, 231, 44])
  assert.equal(m.usageOf('MediaPlayPause'), undefined)
})

test('recording: real or fixed waits, held keys released at the end', () => {
  const rec = [{ usage: 224, press: true, time: 0 }, { usage: 6, press: true, time: 80 }, { usage: 6, press: false, time: 130 }]
  const steps = m.fromRecording(rec)
  assert.deepEqual(steps.map(e => [e.code, m.isPress(e), e.delay]), [[224, true, 80], [6, true, 50], [6, false, 0], [224, false, 0]])
  assert.deepEqual(m.fromRecording(rec, 20).map(e => e.delay), [20, 20, 20, 0])
  assert.deepEqual(m.fromRecording([]), [])
})
