import assert from 'node:assert/strict'
import test from 'node:test'
import { allowsDevWriteOrigin } from '../server/write-origin.ts'

test('LAN writes require the configured address and the same browser-facing host and port', () => {
  const ip = '192.168.1.20'
  const host = ip + ':5173'
  assert.equal(allowsDevWriteOrigin('http://' + host, host, ip), true)
  assert.equal(allowsDevWriteOrigin('http://' + host, host, undefined), false)
  assert.equal(allowsDevWriteOrigin('http://' + host, host, '192.168.1.21'), false)
  assert.equal(allowsDevWriteOrigin('http://' + host, ip + ':3001', ip), false)
  assert.equal(allowsDevWriteOrigin('http://192.168.1.21:5173', host, ip), false)
  assert.equal(allowsDevWriteOrigin('null', host, ip), false)
})

test('loopback development keeps supporting its separate frontend and API ports', () => {
  for (const name of ['localhost', '127.0.0.1']) {
    assert.equal(allowsDevWriteOrigin('http://' + name + ':5173', '127.0.0.1:3001', undefined), true)
  }
})
