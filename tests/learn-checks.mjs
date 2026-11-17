/**
 * Goal checks, with no browser: code patterns match the program the way a
 * person reads it (spaces, quotes, parentheses and extra keyword arguments do
 * not matter; `...` is anything), counts and scopes, order, the checks of
 * what happened, and the regular-expression shapes a pack may not use.
 */
import { met } from '../src/learn/checks.js'
import { riskyRegex, RegexTester } from '../src/learn/regex.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok  ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    failures++
  }
}

const seen = (program, more = {}) => ({ program, runs: [], events: [], printed: new Set(), picked: new Set(), ...more })
const has = (pattern, program, more = {}) => met({ has: pattern, ...more }, seen(program))

console.log('Patterns')
check('a call, however it is spaced', has('motors.run(LEFT, 50)', 'from botcore import *\nmotors.run( LEFT ,50 )\n'))
check('not with another argument', !has('motors.run(LEFT, 50)', 'motors.run(LEFT, 40)\n'))
check('... is any argument', has('motors.run(LEFT, ...)', 'motors.run(LEFT, speed * 2)\n'))
check('the call may have more keyword arguments', has('pixels.set(0, RED)', 'pixels.set(0, RED, brightness=40)\n'))
check('a keyword argument the pattern names must be there', !has('pixels.set(0, RED, brightness=40)', 'pixels.set(0, RED)\n'))
check('and have its value', has('pixels.set(0, RED, brightness=40)', 'pixels.set(0, RED, brightness=40.0)\n'))
check('numbers by value (1 is 1.0, 0b11111111 is 255)', has('delay = 1', 'delay = 1.0\n') && has('leds.user(0b11111111)', 'leds.user(255)\n'))
check('strings by value, either quote', has("display.show('Hi')", 'display.show("Hi")\n'))
check('parentheses do not matter', has('n = n + 1', 'n = (n + 1)\n'))
check('a call inside anything', has('leds.user(255)', 'while True:\n    if x:\n        leds.user(255)\n'))
check('a name is a name', !has('leds.user(255)', 'leds.ls(255)\n'))
check('an if with elif and else matches if a: ...', has('if buttons.was_pressed(0): ...', 'if buttons.was_pressed(0):\n    a()\nelif b:\n    pass\nelse:\n    c()\n'))
check('a body names statements in order, others between', has('while True:\n    leds.user(255)\n    sleep(1)', 'while True:\n    x = 1\n    leds.user(255)\n    y = 2\n    sleep(1)\n'))
check('but not out of order', !has('while True:\n    sleep(1)\n    leds.user(255)', 'while True:\n    leds.user(255)\n    sleep(1)\n'))
check('a function by its name and parameters', has('def note(freq, duration): ...', 'def note(freq, duration):\n    audio.pitch(freq, duration)\n'))
check('x += 1', has('count += 1', 'count += 1\n') && !has('count += 1', 'count = count + 1\n'))
check('comments are not code', !has('leds.user(255)', '# leds.user(255)\nx = 1\n'))
check('a program that does not parse meets no code check', !has('x = 1', 'x = 1\nif\n'))

console.log('Counts and scopes')
const three = 'motors.run(LEFT, 50)\nsleep(1)\nmotors.run(LEFT, 0)\nsleep(1)\nmotors.run(RIGHT, 50)\n'
check('min', has('motors.run(...)', three, { min: 3 }) && !has('motors.run(...)', three, { min: 4 }))
check('max: 0 is none', has('print(...)', three, { max: 0 }) && !has('sleep(...)', three, { max: 0 }))
const inIf = 'if buttons.was_pressed(0):\n    leds.user_num(0, True)\nleds.user_num(1, True)\n'
check('in: inside a statement matching', has('leds.user_num(0, True)', inIf, { in: 'if buttons.was_pressed(0): ...' }))
check('in: not outside it', !has('leds.user_num(1, True)', inIf, { in: 'if buttons.was_pressed(0): ...' }))
check('order', met({ order: ['motors.enable(True)', 'motors.run(LEFT, ...)', 'motors.enable(False)'] }, seen('motors.enable(True)\nmotors.run(LEFT, 50)\nmotors.enable(False)\n')))
check('order, not met out of order', !met({ order: ['motors.enable(True)', 'motors.run(LEFT, ...)'] }, seen('motors.run(LEFT, 50)\nmotors.enable(True)\n')))

console.log('What happened')
check('runs: a run without an error', met({ runs: true }, seen('', { runs: [{ ok: true, seconds: 0.2 }] })) && !met({ runs: true }, seen('', { runs: [{ ok: false, seconds: 3 }] })))
check('runs for at least n seconds', met({ runs: true, seconds: 2 }, seen('', { runs: [{ ok: true, seconds: 2.5 }] })) && !met({ runs: true, seconds: 2 }, seen('', { runs: [{ ok: true, seconds: 1 }] })))
check('prints: a regex output matched', met({ prints: '^hello' }, seen('', { printed: new Set(['^hello']) })) && !met({ prints: '^hello' }, seen('')))
check('event, with a name', met({ event: 'file-created', name: 'a.py' }, seen('', { events: [{ name: 'file-created', detail: 'a.py' }] })) && !met({ event: 'file-created', name: 'a.py' }, seen('', { events: [{ name: 'file-created', detail: 'b.py' }] })))
check('all and any', met({ all: [{ has: 'x = 1' }, { any: [{ event: 'stepped' }, { runs: true }] }] }, seen('x = 1\n', { runs: [{ ok: true, seconds: 1 }] })))

console.log('Regular expressions a pack may not use')
for (const r of ['(a+)+$', '(a*)*b', '(\\w+\\s?)*$', '(a|aa)+', '((ab)*)+', '(x+x+)+y', '(.*a){2,}', '(a)\\1', '(?<n>a)\\k<n>']) check(`refused: /${r}/ (${riskyRegex(r)})`, riskyRegex(r) !== null)
for (const r of ['^hello', '\\d+ cm', '(ab)+', '(\\d+)?', '[a-z(+]+$', '(?:x|y)z', '(?<n>a)b', '(?<=a)b', '\\(a+\\)+', 'temp: -?\\d+(\\.\\d+)?', '(a|b)?c']) check(`allowed: /${r}/`, riskyRegex(r) === null, riskyRegex(r))

console.log('The time-box starts once its worker has loaded')
{
  /**
   * A stand-in worker: loads in `startMs` (never, if null), answers each test
   * in `matchMs`. Like a real one, what is sent before it loads waits until it has.
   */
  class FakeWorker extends EventTarget {
    constructor({ startMs, matchMs }) {
      super()
      this.matchMs = matchMs
      this.terminated = false
      this.waiting = []
      if (startMs !== null) {
        setTimeout(() => {
          this.loaded = true
          this._send({ ready: true })
          this.waiting.forEach((m) => this.postMessage(m))
        }, startMs)
      }
    }
    postMessage(m) {
      if (!this.loaded) return this.waiting.push(m)
      setTimeout(() => this._send({ id: m.id, match: new RegExp(m.source).test(m.text) }), this.matchMs)
    }
    terminate() {
      this.terminated = true
    }
    _send(data) {
      if (this.terminated) return
      const e = new Event('message')
      e.data = data
      this.dispatchEvent(e)
    }
  }
  const quietly = async (fn) => {
    const warn = console.warn
    console.warn = () => {}
    try {
      return await fn()
    } finally {
      console.warn = warn
    }
  }
  const made = []
  const tester = (startMs, matchMs, startLimitMs) =>
    new RegexTester({ startLimitMs, makeWorker: () => (made.push(new FakeWorker({ startMs, matchMs })), made.at(-1)) })

  // A worker 300 ms in loading (well past the 100 ms limit), then quick.
  const coldStart = tester(300, 5)
  check('a good regex on a slow-loading worker matches', (await coldStart.test('^ok', 'ok')) === true)
  check('and is not marked slow', !coldStart.slow.has('^ok'))

  // A worker that loads at once, but a test that takes 200 ms.
  made.length = 0
  const slowMatch = tester(0, 200)
  check('a test over 100 ms counts as not matching', (await quietly(() => slowMatch.test('^ok', 'ok'))) === false)
  check('marks the regex slow and ends its worker', slowMatch.slow.has('^ok') && made[0].terminated)
  check('the slow regex is not tried again', (await slowMatch.test('^ok', 'ok')) === false && made.length === 1)

  // A worker that never loads: given up after its start limit, the regex not blamed, a new worker next time.
  made.length = 0
  const neverStarts = tester(null, 5, 150)
  check('a worker that never loads gives up the test', (await quietly(() => neverStarts.test('^ok', 'ok'))) === false)
  check('without marking the regex slow', !neverStarts.slow.has('^ok') && made[0].terminated)
  await quietly(() => neverStarts.test('^ok', 'ok'))
  check('and the next test makes a new worker', made.length === 2)
}

if (failures) {
  console.log(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nall passed')
