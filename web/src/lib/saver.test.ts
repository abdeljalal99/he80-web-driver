import { test } from 'node:test'
import assert from 'node:assert/strict'
import { combine, createSaver, type SaveState } from './saver.ts'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('a burst of edits becomes one save of the newest value', async () => {
  const saved: number[] = [], states: SaveState[] = []
  const s = createSaver<number>(async v => { saved.push(v) }, 10, st => states.push(st))
  for (let i = 1; i <= 20; i++) s.push(i)
  await sleep(40)
  assert.deepEqual(saved, [20])
  assert.deepEqual(states, ['saving', 'saved'])
})

test('edits during a slow save are saved after it, newest only, never in parallel', async () => {
  const saved: number[] = []
  let running = 0, maxRunning = 0
  const s = createSaver<number>(async v => {
    running++; maxRunning = Math.max(maxRunning, running)
    await sleep(30)
    saved.push(v); running--
  }, 5, () => {})
  s.push(1)
  await sleep(15) // first save running
  s.push(2); s.push(3)
  await sleep(100)
  assert.deepEqual(saved, [1, 3])
  assert.equal(maxRunning, 1)
})

test('a failed save reports the error and drops queued edits', async () => {
  const states: SaveState[] = []
  const s = createSaver<number>(async () => { throw new Error('unplugged') }, 5, st => states.push(st))
  s.push(1)
  await sleep(30)
  assert.equal(states[0], 'saving')
  assert.match(String(states[1]), /unplugged/)
  assert.equal(s.pending, null)
})

test('combined status: an error is not hidden by another region saving fine', () => {
  const err = new Error('rt failed')
  assert.equal(combine([]), null)
  assert.equal(combine(['saved', 'saving']), 'saving')
  assert.equal(combine([err, 'saved']), err)
  assert.equal(combine(['saved', 'saved']), 'saved')
})
