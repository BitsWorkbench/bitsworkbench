/**
 * The welcome and the demo: the welcome shows on every visit (Welcome, then
 * Welcome back with Resume), always with Try a Demo!; the demo is a small
 * guided CodeBot mission in blocks, in the simulator without asking, in a file
 * of its own, played to its end, which offers the program in Python. At a
 * Chromebook's size and a phone's. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'

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

const SIZES = [
  ['Chromebook 1366x768', 1366, 768, false],
  ['Phone 390x844', 390, 844, true],
]

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
for (const [name, width, height, touch] of SIZES) {
  console.log(name)
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch })
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`))
  const welcome = () => page.waitForSelector('#modal[open] button[value="choice:demo"]', { timeout: 10000 }).then(() => true, () => false)
  const title = () => page.locator('#modal[open] h2').innerText()
  const onScreen = (sel) => page.evaluate((sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    return !!r && r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
  }, sel)

  // A first visit.
  await page.goto(BASE, { waitUntil: 'networkidle' })
  check(await welcome(), 'the first visit is welcomed, with Try a Demo!')
  check((await title()) === 'Welcome to BitsWorkbench!', 'Welcome to BitsWorkbench!')
  const body = await page.locator('#modal[open] .modal-body').innerText()
  check(/Blocks or Python/.test(body) && /simulated/.test(body) && /open source, from Firia Labs/.test(body) && /community/.test(body), 'it says Blocks or Python, real or simulated, open source from Firia Labs, open to the community')
  check((await page.locator('#modal[open] button[value="choice:go"]').innerText()) === "Let's go!", "and Let's go!")
  check(await onScreen('#modal[open] button[value="choice:demo"]'), 'its buttons are on screen')
  await page.click('#modal[open] button[value="choice:go"]')

  // Every visit after.
  await page.reload({ waitUntil: 'networkidle' })
  check(await welcome(), 'it shows again on the next visit')
  check((await title()) === 'Welcome back to BitsWorkbench' && (await page.locator('#modal[open] button[value="choice:go"]').innerText()) === 'Resume', 'as Welcome back, with Resume')

  // The demo.
  await page.click('#modal[open] button[value="choice:demo"]')
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 30000 })
  const s = await page.evaluate(() => ({ sim: window.openCodeBot.device.simulating, board: window.openCodeBot.device.targetId, learn: document.querySelector('#btn-learn .btn-text').textContent }))
  check(s.sim && s.board === 'codebot', `CodeBot comes up in the simulator, nothing asked (${s.board})`)
  check(s.learn === 'Exit tutorial', 'in tutorial mode')
  await page.click('.journey-centre [data-journey="begin"]')
  await page.waitForSelector('.journey-bubble:not([hidden])')
  check((await page.evaluate(() => window.openCodeBot.openFile.path)) === 'demo/demo.py', 'the demo works in demo/demo.py')

  const met = () => page.waitForSelector('.journey-bubble.good', { timeout: 20000 }).then(() => true, () => false)
  const next = async () => {
    await page.click('.journey-bubble [data-journey="next"]')
    await page.waitForTimeout(400)
  }
  const run = async () => {
    await page.waitForSelector('#btn-run:not([hidden]):not([disabled])', { timeout: 15000 })
    await page.click('#btn-run')
  }
  const load = (py) => page.evaluate((py) => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython(py).state)
  }, py)
  const at = () => page.evaluate(() => window.openCodeBot.learn.journey.steps[window.openCodeBot.learn.journey.index]?.id)
  const pointed = () => page.evaluate(() => { const j = window.openCodeBot.learn.journey; return !!j._locate(j.steps[j.index]) })

  // 1: look around (skippable)
  check((await at()) === 'DEMO_look' && (await pointed()), 'step 1 points at the simulator')
  await page.click('.journey-bubble [data-journey="skip"]')
  await page.waitForTimeout(400)
  // 2: Run
  check((await at()) === 'DEMO_run' && (await pointed()), 'step 2 points at Run')
  await run()
  check(await met(), 'running meets it')
  await next()
  // 3: full power
  check((await at()) === 'DEMO_power' && (await pointed()), 'step 3 points at the power in the drive block')
  const start = await page.evaluate(() => window.openCodeBot._currentPython())
  await load(start.replace('motors.run(LEFT, 50)', 'motors.run(LEFT, 100)').replace('motors.run(RIGHT, 50)', 'motors.run(RIGHT, 100)'))
  check(await met(), 'full power meets it')
  await next()
  await run()
  check(await met(), 'running again meets step 4')
  await page.waitForSelector('#btn-run:not([hidden])', { timeout: 15000 })
  await next()
  // 5: Lights
  check((await at()) === 'DEMO_palette' && (await pointed()), 'step 5 points at the Lights category')
  await page.evaluate(() => window.openCodeBot.learn.journey.places.openPalette('lights'))
  check(await met(), 'opening it meets it')
  await next()
  check((await at()) === 'DEMO_leds' && (await pointed()), 'step 6 points at the LED block in the palette')
  const now = await page.evaluate(() => window.openCodeBot._currentPython())
  await load(`${now.trimEnd()}\nleds.user(0xFF)\n`)
  check(await met(), 'adding it meets it')
  await next()
  await run()
  check(await met(), 'running meets step 7')
  await page.waitForSelector('#btn-run:not([hidden])', { timeout: 15000 })
  await next()
  // 8: the question
  await page.click('.journey-answers [data-value="1"]')
  check(await met(), 'the right answer meets the last step')
  await next()
  await page.waitForSelector('.journey-centre [data-journey="finish"]', { timeout: 5000 })
  check(await onScreen('.journey-centre [data-journey="finish"]'), 'the finish card, on screen')
  await page.click('.journey-centre [data-journey="finish"]')
  // The end: the same program in Python, one press away.
  const offered = await page.waitForSelector('#modal[open] button[value="choice:python"]', { timeout: 5000 }).then(() => true, () => false)
  check(offered, 'the end offers the program in Python')
  if (offered) await page.click('#modal[open] button[value="choice:python"]')
  await page.waitForTimeout(800)
  const end = await page.evaluate(() => ({ text: window.openCodeBot.workspace.mode === 'text', open: window.openCodeBot.learn.isOpen, py: window.openCodeBot._currentPython() }))
  check(end.text && !end.open && end.py.includes('leds.user(0xFF)'), 'and shows it in Python, out of the tutorial')
  await context.close()
}
await browser.close()
server?.kill()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
