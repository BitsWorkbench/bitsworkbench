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
  // No service worker: a part missing from the server is missing (as for a page left on an old build).
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, serviceWorkers: 'block' })
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

  // The demo, in one click: a page that reloads on its way there (onto a new build) goes straight in.
  // As after a deploy: the simulator's picture is gone from the server, so the page reloads onto the new build.
  let gone = true
  await page.route(/\/assets\/view-[^/]*\.js$/, (route) => (gone ? route.fulfill({ status: 404, body: '' }) : route.continue()))
  const reloaded = page.waitForEvent('framenavigated', { timeout: 20000 }).then(() => true, () => false)
  await page.click('#modal[open] button[value="choice:demo"]')
  const didReload = await reloaded
  gone = false
  await page.waitForLoadState('networkidle')
  check(didReload && !(await welcome()), 'Try a Demo! is one click, even when the page reloads onto a new build on the way')
  await page.unroute(/\/assets\/view-[^/]*\.js$/)
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 30000 })
  check(/^Meet CodeBot!/.test(await page.locator('.journey-centre p').first().innerText()), 'Meet CodeBot!')
  const s = await page.evaluate(() => ({ sim: window.openCodeBot.device.simulating, board: window.openCodeBot.device.targetId, learn: document.querySelector('#btn-learn .btn-text').textContent }))
  check(s.sim && s.board === 'codebot', `CodeBot comes up in the simulator, nothing asked (${s.board})`)
  check(s.learn === 'Exit tutorial', 'in tutorial mode')
  check(await page.evaluate(() => window.openCodeBot.device.sim.cameraMode === 'chase' && window.openCodeBot.device.sim.cameraOpts.turn === 150), 'the chase camera, looking at CodeBot\'s front')
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

  // 1: look around: met by turning the view 45 degrees, not by a nudge.
  check((await at()) === 'DEMO_look' && (await pointed()), 'step 1 points at the simulator')
  const drag = async (dx) => {
    const r = await page.locator('#panel-sim canvas.sim-canvas').boundingBox()
    const x = r.x + r.width * 0.3, y = r.y + r.height * 0.75
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y)
    await page.mouse.up()
  }
  const quickly = () => page.waitForSelector('.journey-bubble.good', { timeout: 1500 }).then(() => true, () => false)
  if (!touch) {
    await drag(15)
    check(!(await quickly()), 'a nudge of the view does not meet it')
    await drag(Math.round((await page.locator('#panel-sim canvas.sim-canvas').boundingBox()).width * 0.5))
    check(await met(), 'turning it 45 degrees does')
    await next()
  } else {
    await page.click('.journey-bubble [data-journey="skip"]')
    await page.waitForTimeout(400)
  }
  // 2: the blocks, to read
  check((await at()) === 'DEMO_program' && (await pointed()), 'step 2 points at the blocks')
  check(/top down/.test(await page.locator('.journey-bubble .journey-say').innerText()), 'and says what they do')
  await next()
  // 3: Run
  check((await at()) === 'DEMO_run' && (await pointed()), 'step 3 points at Run')
  check(!/These blocks/.test(await page.locator('.journey-bubble .journey-say').innerText()), 'and talks of Run, not the blocks')
  await run()
  check(await met(), 'running meets it')
  // The goals HUD over the simulator, and the rail: the pack, the mission, the objectives.
  const hud = await page.evaluate(() => {
    const h = document.querySelector('#panel-sim .goals-hud:not([hidden])')
    return h && { text: h.textContent, done: h.querySelectorAll('.goals-hud-box[data-done="true"]').length, boxes: h.querySelectorAll('.goals-hud-box').length }
  })
  // (A phone's view, under the coach, is too short for it.)
  if (!touch) check(!!hud && /Objective 1:\s*Drive/.test(hud.text) && hud.boxes === 4 && hud.done === 2, `the goals HUD shows the objective and its goals, two met (${JSON.stringify(hud)})`)
  const rail = await page.evaluate(() => [...document.querySelectorAll('#learn-rail [data-rail="missions"], #learn-rail [data-rail-chapter]')].map((b) => `${b.querySelector('img') ? 'img ' : ''}${b.title}`))
  check(/^img Mission pack: /.test(rail[0]) && /^img Mission 1: Drive CodeBot/.test(rail[1]) && /^Objective 1 of 2: Drive/.test(rail[2]), `the rail: the pack's picture, the mission's, then the objectives (${rail.join(' | ')})`)
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
  // Dropped loose, beside the program: not snapped in.
  const loose = await page.evaluate(() => {
    const ws = window.openCodeBot.workspace.workspace
    const b = ws.newBlock('codebot_leds_all')
    b.initSvg()
    b.render()
    b.moveBy(40, 400)
    return b.id
  })
  check(!(await quickly()), 'a block dropped loose is not snapped in')
  await page.evaluate((id) => window.openCodeBot.workspace.workspace.getBlockById(id).dispose(), loose)
  const now = await page.evaluate(() => window.openCodeBot._currentPython())
  await load(`${now.trimEnd()}\nleds.user(0xFF)\n`)
  check(await met(), 'adding it meets it')
  await next()
  await run()
  check(await met(), 'running meets the last step')
  await page.waitForSelector('#btn-run:not([hidden])', { timeout: 15000 })
  check(await page.evaluate(() => window.openCodeBot.learn.journey.steps.length === 8), 'in blocks, eight steps and no Python question')
  await next()
  await page.waitForSelector('.journey-centre [data-journey="finish"]', { timeout: 5000 })
  check(/from your blocks/.test(await page.locator('.journey-centre').innerText()), 'the finish, in words for blocks')
  check(await onScreen('.journey-centre [data-journey="finish"]'), 'the finish card, on screen')
  await page.click('.journey-centre [data-journey="finish"]')
  // The end: the same again, in Python.
  const offered = await page.waitForSelector('#modal[open] button[value="choice:again"]', { timeout: 5000 }).then(() => true, () => false)
  check(offered, 'the end offers to try it in Python')
  await page.click('#modal[open] button[value="choice:again"]')
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 15000 })
  check(await page.evaluate(() => window.openCodeBot.workspace.mode === 'text' && window.openCodeBot.learn.journey.mode === 'python'), 'in the Python view, the demo starts again in Python')
  await page.click('.journey-centre [data-journey="begin"]')
  // demo.py holds only what the guide left there: it starts over without asking, and no demo_2.py.
  check(!(await page.waitForSelector('#modal[open] button[value="choice:save"]', { timeout: 2500 }).then(() => true, () => false)), 'demo.py as the guide left it is replaced without asking')
  await page.waitForSelector('.journey-bubble:not([hidden])')
  check(!(await page.evaluate(() => window.openCodeBot.stores.browser.exists('demo/demo_2.py'))), 'and no demo_2.py')
  const type = (py) => page.evaluate(async (py) => {
    const app = window.openCodeBot
    await app.pythonEditor.load()
    const view = app.pythonEditor.view
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: py } })
  }, py)
  await page.click('.journey-bubble [data-journey="skip"]')
  await page.waitForTimeout(400)
  check((await at()) === 'DEMO_program' && (await pointed()), 'Python: the step points at the program')
  await next()
  await run()
  check(await met(), 'Python: running meets it')
  await next()
  check((await at()) === 'DEMO_power' && (await pointed()), 'Python: the step points at the 50 in the editor')
  check(/both/.test(await page.locator('.journey-bubble .journey-say').innerText()), 'Python: in Python\'s words')
  const py = await page.evaluate(() => window.openCodeBot._currentPython())
  await type(py.replaceAll(', 50)', ', 100)'))
  check(await met(), 'Python: typing 100 for both meets it')
  await next()
  await run()
  check(await met(), 'Python: running again')
  await page.waitForSelector('#btn-run:not([hidden])', { timeout: 15000 })
  await next()
  check((await at()) === 'DEMO_palette' && (await pointed()), 'Python: the step points at the Python palette\'s Lights')
  await page.click('#py-palette .py-cat[data-id="lights"]')
  check(await met(), 'Python: opening Lights meets it')
  await next()
  check((await at()) === 'DEMO_leds' && (await pointed()), 'Python: the step points at the Lights category, the code left in sight')
  // The card goes in where the cursor is: at the end, as a drag there would put it.
  await page.evaluate(() => {
    const view = window.openCodeBot.pythonEditor.view
    const last = view.state.doc.line(view.state.doc.lines - (view.state.doc.line(view.state.doc.lines).text.trim() ? 0 : 1))
    view.dispatch({ selection: { anchor: last.to } })
  })
  await page.click('#py-palette .py-cat[data-id="lights"]')
  check(await pointed(), 'Python: once Lights is open, the step points at the card')
  await page.locator('#py-palette .snippet').filter({ hasText: /^leds\.user\(0xFF\)$/ }).click()
  check(await met(), 'Python: the card goes in under the last line, and meets it')
  check((await page.locator('.journey-bubble .journey-say').innerText()).trim() === 'Code added.', 'Python: Code added.')
  check((await page.evaluate(() => window.openCodeBot._currentPython())).trimEnd().endsWith('leds.user(0xFF)'), 'Python: at the end of the program')
  await next()
  await run()
  check(await met(), 'Python: running')
  await page.waitForSelector('#btn-run:not([hidden])', { timeout: 15000 })
  await next()
  await page.click('.journey-answers [data-value="1"]')
  check(await met(), 'Python: the question')
  check(!/blocks in/.test(await page.locator('.journey-bubble').innerText()), 'Python: no words about blocks under it')
  await next()
  check(/from your Python/.test(await page.locator('.journey-centre').innerText()), 'Python: the finish, in words for Python')
  await page.click('.journey-centre [data-journey="finish"]')
  check(await page.waitForSelector('#modal[open] button[value="choice:exit"]', { timeout: 5000 }).then(() => true, () => false), 'done in Python: the way out')
  await page.click('#modal[open] button[value="choice:exit"]')
  await page.waitForTimeout(500)
  check(await page.evaluate(() => !window.openCodeBot.learn.isOpen), 'out of the tutorial')
  // Changed by the student after the guide: the demo again asks before it replaces their work.
  const mine = await page.evaluate(() => window.openCodeBot._currentPython())
  await type(`${mine.trimEnd()}\nprint("mine")\n`)
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.openCodeBot.learn.openDemo())
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 15000 })
  await page.click('.journey-centre [data-journey="begin"]')
  check(await page.waitForSelector('#modal[open] button[value="choice:save"]', { timeout: 5000 }).then(() => true, () => false), 'demo.py changed by the student: it is theirs to keep')
  await page.click('#modal[open] button[value="choice:save"]')
  await page.waitForSelector('.journey-bubble:not([hidden])')
  const kept = await page.evaluate(() => window.openCodeBot.stores.browser.read('demo/demo_2.py').catch(() => null))
  check(kept?.includes('print("mine")'), 'kept as demo/demo_2.py')
  await context.close()
}
await browser.close()
server?.kill()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
