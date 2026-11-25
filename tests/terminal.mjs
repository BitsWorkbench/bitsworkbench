/**
 * The terminal's handling of a board's line editor (src/ui/line-edits.js):
 * cursor-back becomes backspaces, clear-to-end-of-line clears the wrapped
 * rows too, colours and every other sequence go through untouched, and a
 * sequence split across reads is held until it is whole.
 */
import assert from 'node:assert/strict'
import { LineEdits } from '../src/ui/line-edits.js'

let failed = 0
const test = (name, fn) => {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed++
    console.log(`  FAIL  ${name}\n${err.message}`)
  }
}
const run = (...chunks) => {
  const f = new LineEdits()
  return chunks.map((c) => f.push(c)).join('')
}
const bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const text = (b) => String.fromCharCode(...b)

test('ESC [ n D becomes n backspaces', () => {
  assert.equal(run('abc\x1b[12Dxyz'), `abc${'\b'.repeat(12)}xyz`)
  assert.equal(run('\x1b[D'), '\b')
})
test('ESC [ K (and ESC [ 0 K) clears to the end of the screen', () => {
  assert.equal(run('1+1\x1b[K'), '1+1\x1b[J')
  assert.equal(run('1+1\x1b[0K'), '1+1\x1b[J')
  assert.equal(run('\x1b[2K'), '\x1b[2K')
})
test('colours, bold, reset and other sequences go through as they are', () => {
  for (const s of ['\x1b[31mRED\x1b[0m', '\x1b[1;38;5;208mORANGE\x1b[0m', '\x1b[38;2;10;20;30mrgb', '\x1b[?45h', '\x1b]0;title\x1b\\', '\x1b[2J\x1b[H', '\x1b[5C', '\x1bc']) {
    assert.equal(run(s), s, JSON.stringify(s))
  }
})
test('a sequence split across reads is held until whole', () => {
  assert.equal(run('ab\x1b', '[1', '2D', 'c'), `ab${'\b'.repeat(12)}c`)
  assert.equal(run('x\x1b[', 'K'), 'x\x1b[J')
  assert.equal(run('\x1b[3', '1mred'), '\x1b[31mred')
})
test('bytes in, bytes out, UTF-8 untouched', () => {
  const f = new LineEdits()
  const hi = new TextEncoder().encode('é🙂')
  const out = f.push(Uint8Array.from([...bytes('a\x1b[5D'), ...hi]))
  assert.ok(out instanceof Uint8Array)
  assert.equal(new TextDecoder().decode(out), `a${'\b'.repeat(5)}é🙂`)
  assert.equal(text(f.push(bytes('\x1b[K'))), '\x1b[J')
})
test('a long run of output goes through whole', () => {
  const big = 'x'.repeat(200000)
  assert.equal(run(big), big)
})

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nterminal: all good')
