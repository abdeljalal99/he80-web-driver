import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GROUPS } from './choices.ts'
import { decodeAction, encodeAction } from './protocol.ts'

test('every picker choice is a valid key map entry with a real name', () => {
  for (const g of GROUPS) {
    assert.equal(new Set(g.choices.map(c => c.label)).size, g.choices.length, `duplicate label in ${g.name}`)
    for (const c of g.choices) {
      assert.doesNotMatch(c.label, /^0x/, `${g.name}: unnamed usage ${c.label}`)
      assert.deepEqual(decodeAction(encodeAction(c.action)), c.action, `${g.name}: ${c.label}`)
    }
  }
  const f16 = GROUPS.find(g => g.name === 'Function keys')!.choices.find(c => c.label === 'F16')!
  assert.deepEqual(encodeAction(f16.action), [2, 0, 0x6b, 0]) // matches the board's Caps → F16 entry
})

