/**
 * A MicroPython / CircuitPython board (the generic target), with no hardware
 * and no browser: the DeviceManager against a scripted board that speaks the
 * REPL as MicroPython and CircuitPython do (the friendly prompt, Ctrl-B's
 * banner, and the raw REPL: OK, output, EOT, error, EOT, `>`).
 *
 * Checked: the board's banner sets the flavor; Run sends the program through
 * the raw REPL and writes no file; the terminal shows the program's output
 * and none of the raw REPL's markers; an error names its line; Stop ends a
 * program that runs forever; a long program arrives whole; and a file that
 * cannot be written on a read-only drive says why.
 */
globalThis.localStorage ??= { getItem: () => null, setItem: () => {} }

const { DeviceManager } = await import('../src/device/device-manager.js')
const { genericFlavor, setGenericFlavor } = await import('../src/device/flavor.js')
const { t } = await import('../src/i18n/index.js')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${name}${ok || !detail ? '' : `: ${detail}`}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 3000) => {
  for (let i = 0; i < ms / 10; i++) {
    if (fn()) return true
    await sleep(10)
  }
  return false
}

const BANNER = {
  micropython: 'MicroPython v1.24.1 on 2024-11-29; Raspberry Pi Pico with RP2040\r\nType "help()" for more information.',
  circuitpython: 'Adafruit CircuitPython 9.2.1 on 2024-11-20; Raspberry Pi Pico with rp2040',
}

/** A board's REPL, as far as the app uses it. */
class FakeBoard {
  constructor(manager, flavor, { readOnly = false } = {}) {
    this.manager = manager
    this.flavor = flavor
    this.readOnly = readOnly
    this.mode = 'friendly' // 'friendly' | 'raw' | 'running'
    this.code = ''
    this.received = '' // everything the app sent
    this.programs = [] // every program the raw REPL ran
    this.pendingB = false
  }

  say(text) {
    setTimeout(() => this.manager._onBytes(new TextEncoder().encode(text)), 1)
  }

  receive(data) {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    this.received += text
    for (const ch of text) this.char(ch)
  }

  char(ch) {
    if (this.mode === 'running') {
      if (ch === '\x03') {
        this.say('\x04Traceback (most recent call last):\r\n  File "<stdin>", line 2, in <module>\r\nKeyboardInterrupt: \r\n\x04>')
        this.mode = 'raw'
        if (this.pendingB) this.char('\x02')
      } else if (ch === '\x02') {
        this.pendingB = true // waits in the input buffer until the program ends
      }
      return
    }
    if (this.mode === 'raw') {
      if (ch === '\x02') {
        this.pendingB = false
        this.mode = 'friendly'
        this.say(`\r\n${BANNER[this.flavor]}\r\n>>> `)
      } else if (ch === '\x04') {
        this.exec(this.code)
        this.code = ''
      } else if (ch !== '\x03' && ch !== '\x01') {
        this.code += ch
      }
      return
    }
    // friendly
    if (ch === '\x01') {
      this.mode = 'raw'
      this.say('raw REPL; CTRL-B to exit\r\n>')
    } else if (ch === '\x02') {
      this.say(`\r\n${BANNER[this.flavor]}\r\n>>> `)
    } else if (ch === '\x03' || ch === '\r') {
      this.say('\r\n>>> ')
    }
  }

  /** Run what the raw REPL was given: just enough Python for these checks. */
  exec(code) {
    if (/^fd=open\(/.test(code)) {
      this.say(this.readOnly
        ? 'OK\x04Traceback (most recent call last):\r\n  File "<stdin>", line 1, in <module>\r\nOSError: [Errno 30] Read-only filesystem\r\n\x04>'
        : 'OK\x04\x04>')
      return
    }
    if (/^(w=fd\.write|w\(|fd\.close|try:)/.test(code)) {
      this.say('OK\x04\x04>')
      return
    }
    this.programs.push(code)
    if (/while True/.test(code)) {
      this.say('OK')
      this.mode = 'running'
      return
    }
    const raised = /raise (\w+)\("([^"]*)"\)/.exec(code)
    const out = [...code.matchAll(/print\("([^"]*)"\)/g)].map((m) => `${m[1]}\r\n`).join('')
    if (raised) {
      const line = code.split('\n').findIndex((l) => l.includes('raise')) + 1
      this.say(`OK${out}\x04Traceback (most recent call last):\r\n  File "<stdin>", line ${line}, in <module>\r\n${raised[1]}: ${raised[2]}\r\n\x04>`)
    } else {
      this.say(`OK${out}\x04\x04>`)
    }
  }
}

/** A DeviceManager on a fake board, connected and at its prompt. */
async function connected(flavor, options) {
  const manager = new DeviceManager()
  const board = new FakeBoard(manager, flavor, options)
  manager.link = { supported: true, isOpen: true, anyPort: true, send: async (data) => board.receive(data) }
  manager.repl.link = manager.link
  const shown = []
  const states = []
  const errors = []
  const notices = []
  manager.addEventListener('data', (e) => shown.push(new TextDecoder().decode(e.detail)))
  manager.addEventListener('state', (e) => states.push(e.detail))
  manager.addEventListener('program-error', (e) => errors.push(e.detail))
  manager.addEventListener('notice', (e) => notices.push(e.detail))
  manager._onConnected('generic')
  board.say('>>> ')
  return { manager, board, shown, states, errors, notices, text: () => shown.join('') }
}

for (const flavor of ['micropython', 'circuitpython']) {
  console.log(`A ${flavor} board`)
  setGenericFlavor(flavor === 'micropython' ? 'circuitpython' : 'micropython')
  const b = await connected(flavor)

  check('its banner sets the flavor', await until(() => genericFlavor() === flavor), genericFlavor())
  check('the manager knows it by the generic id', b.manager.targetId === 'generic')

  b.shown.length = 0
  const ok = await b.manager.run('print("hi")\nprint("there")\n')
  check('Run starts the program', ok === true)
  check('it ran from the raw REPL', b.board.programs.at(-1) === 'print("hi")\nprint("there")\n', JSON.stringify(b.board.programs))
  check('and wrote no file', !/open\(|main\.py|code\.py/.test(b.board.received), b.board.received)
  check('it ends at the friendly prompt', await until(() => b.board.mode === 'friendly' && b.manager.state === 'ready'), `${b.board.mode} ${b.manager.state}`)
  const shown = b.text()
  check('the terminal shows its output', shown.includes('hi\r\nthere\r\n'), JSON.stringify(shown))
  check('and none of the raw REPL', !/\x04|raw REPL|OK/.test(shown), JSON.stringify(shown))
  check('the state says it finished', b.states.some((s) => s.message === t('usb.finished')))

  await b.manager.run('x = 1\nraise ValueError("boom")\n')
  check('an error is reported with its line', await until(() => b.errors.length === 1) && b.errors[0].name === 'ValueError' && b.errors[0].line === 2, JSON.stringify(b.errors))
  await until(() => b.board.mode === 'friendly')

  await b.manager.run('while True:\n    pass\n')
  check('a forever program is running', await until(() => b.manager.state === 'running'), b.manager.state)
  const stopped = await b.manager.stop()
  check('Stop gets back to the prompt', stopped && b.board.mode === 'friendly' && b.manager.state === 'ready', `${stopped} ${b.board.mode} ${b.manager.state}`)
  check('and the Stop is not an error', b.errors.length === 1)

  const long = Array.from({ length: 120 }, (_, i) => `print("line ${i} of a long program")`).join('\n') + '\n'
  await b.manager.run(long)
  check('a long program arrives whole', b.board.programs.at(-1) === long, `${b.board.programs.at(-1)?.length} of ${long.length}`)
  await until(() => b.board.mode === 'friendly')
}

console.log('A CircuitPython drive the computer has')
{
  const b = await connected('circuitpython', { readOnly: true })
  await until(() => b.manager.state === 'ready')
  const ok = await b.manager.writeFile('helpers.py', 'x = 1\n')
  check('a file is not written', ok === false)
  check('and the student is told why', b.notices.some((n) => n.detail === t('usb.readOnlyDetail')), JSON.stringify(b.notices))
  check('the board is back at its prompt', await until(() => b.board.mode === 'friendly'), b.board.mode)
}

if (failures) {
  console.error(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nAll good.')
process.exit(0)
