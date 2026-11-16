/**
 * Connect, Run and Stop, end to end, with no hardware: the app is opened with
 * `?device=loopback`, a pretend board that keeps whatever it is sent. Also
 * checks that every registered kind of device fits the DeviceTarget contract
 * in docs/device-targets.md. Run with `npm run build` first.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const URL_ = `${BASE}?device=loopback&board=codebot`

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}

let server = null
if (!(await reachable(BASE))) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 250))
}

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

// Start from nothing so the welcome dialog and saved work do not interfere.
await page.goto(URL_, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
const dismiss = async () => {
  if (await page.evaluate(() => document.getElementById('modal')?.open)) {
    await page.click('#modal button[value="ok"]')
  }
}
await dismiss()

const contract = await page.evaluate(() => {
  const { device } = window.openCodeBot
  const { missingMembers } = window.openCodeBotInternals
  return { kind: device.kind, missing: missingMembers(device) }
})
check(contract.kind === 'loopback', '?device=loopback picks the loopback device')
check(contract.missing.length === 0, `loopback fits the DeviceTarget contract ${contract.missing.join(', ')}`)

await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
await dismiss()
check(true, 'Connect reaches the ready state')

const toolboxHasCodebot = await page.evaluate(() =>
  [...document.querySelectorAll('.blocklyToolboxCategory')].some((r) => r.textContent.includes('Drive')),
)
check(toolboxHasCodebot, 'connecting a CodeBot switches to CodeBot blocks')

await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
// The app's device pairs the page's kind with the simulator; files are the loopback's.
const sent = await page.evaluate(() => window.openCodeBot.device.board.files['main.py'] || '')
check(sent.includes('from botcore import *'), 'Run sends a CodeBot program as main.py')
check(sent.includes('motors.run('), 'the starter program drives the motors')

// xterm parses writes on a later frame, so wait for the text rather than
// reading the buffer straight after Run.
const reachedTerminal = await page
  .waitForFunction(
    () => {
      const buffer = window.openCodeBot.terminal.term.buffer.active
      for (let i = 0; i < buffer.length; i++) {
        if (buffer.getLine(i).translateToString(true).includes('running main.py')) return true
      }
      return false
    },
    null,
    { timeout: 5000 },
  )
  .then(() => true)
  .catch(() => false)
check(reachedTerminal, 'device output reaches the terminal')

await page.click('#btn-stop')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
check(true, 'Stop returns to ready')

// One device at a time. A board on USB gives way to the simulator, and the
// simulator to a board, only once the student agrees; another board in the
// simulator just takes the place of the one loaded.
{
  const modalOpen = () => page.evaluate(() => document.getElementById('modal')?.open)
  const where = () => page.evaluate(() => ({ sim: window.openCodeBot.device.simulating, connected: window.openCodeBot.device.isConnected, target: window.openCodeBot.device.targetId }))
  await page.click('#btn-sim')
  await page.waitForTimeout(200)
  check(await modalOpen(), 'Simulate with a board on USB asks first')
  await page.click('#modal button[value="cancel"]')
  await page.waitForTimeout(200)
  let w = await where()
  check(w.connected && !w.sim, 'keeping the board keeps it connected')
  await page.click('#btn-sim')
  await page.click('#modal button[value="ok"]')
  await page.waitForFunction(() => window.openCodeBot.device.simulating && window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  check(true, 'agreeing moves to the simulator')
  await page.evaluate(() => window.openCodeBot._pickTarget('codex'))
  await page.waitForFunction(() => window.openCodeBot.device.simulating && window.openCodeBot.device.targetId === 'codex' && window.openCodeBot.device.state === 'ready', null, { timeout: 20000 }).catch(() => {})
  w = await where()
  check(!(await modalOpen()) && w.sim && w.target === 'codex', `another board in the simulator takes the loaded one's place, without asking (${JSON.stringify(w)})`)
  await page.evaluate(() => window.openCodeBot._pickTarget('codebot'))
  await page.waitForFunction(() => window.openCodeBot.device.targetId === 'codebot' && window.openCodeBot.device.state === 'ready', null, { timeout: 20000 })
  await page.click('#btn-connect')
  await page.waitForTimeout(200)
  check(await modalOpen(), 'Connect while simulating asks first')
  await page.click('#modal button[value="ok"]')
  await page.waitForFunction(() => !window.openCodeBot.device.simulating && window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => {})
  w = await where()
  check(w.connected && !w.sim, `agreeing connects the board (${JSON.stringify(w)})`)
}

await page.click('#btn-connect')
await page.waitForFunction(() => window.openCodeBot.device.state === 'offline')
check(true, 'Connect again disconnects')

// The simulator: ?device=sim opens straight into it, and it fits the contract too.
await page.goto(`${BASE}?device=sim`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
await dismiss()
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 30000 })
const sim = await page.evaluate(() => {
  const { device } = window.openCodeBot
  const { missingMembers } = window.openCodeBotInternals
  return { kind: device.kind, missing: missingMembers(device.sim), targetId: device.targetId }
})
check(sim.kind === 'sim', '?device=sim opens in the simulator')
check(sim.missing.length === 0, `the simulator fits the DeviceTarget contract ${sim.missing.join(', ')}`)
check(sim.targetId === 'codebot', 'it simulates a CodeBot')

const saved = await page.evaluate(async () => {
  const { device } = window.openCodeBot
  await device.writeFile('note.txt', 'kept')
  await device.run("print(open('note.txt').read())")
  return true
})
const readBack = await page
  .waitForFunction(
    () => {
      const buffer = window.openCodeBot.terminal.term.buffer.active
      for (let i = 0; i < buffer.length; i++) if (buffer.getLine(i).translateToString(true).trim() === 'kept') return true
      return false
    },
    null,
    { timeout: 10000 },
  )
  .then(() => true)
  .catch(() => false)
check(saved && readBack, 'a file saved on the simulator is there for the next program')

// A program that runs until it is stopped: the starter ends by itself in a
// second or two, and on a slow machine Stop was gone before the click landed.
await page.click('#btn-view')
await page.click('#btn-mode')
await page.evaluate(() => {
  window.openCodeBot.pythonEditor.value = 'from time import sleep\nwhile True:\n    sleep(0.1)\n'
})
await page.click('#btn-run')
await page.waitForFunction(() => window.openCodeBot.device.state === 'running')
await page.click('#btn-stop')
await page.waitForFunction(() => window.openCodeBot.device.state === 'ready')
check(true, 'Run and Stop on the simulator')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
