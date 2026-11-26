import assert from 'node:assert/strict'
import test from 'node:test'
import { browserUuid } from '../src/jingshan/browser-uuid.ts'

test('creates version 4 IDs on an HTTP LAN origin without randomUUID', (t) => {
  const webCrypto = { getRandomValues: crypto.getRandomValues.bind(crypto) }
  t.mock.getter(globalThis, 'crypto', () => webCrypto)
  const id = browserUuid()
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(browserUuid(), id)
})
