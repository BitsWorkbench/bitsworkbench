/**
 * The simulator in browsers without JSPI, for real: Playwright's WebKit (the
 * engine of Safari, and of every browser on an iPad) and Firefox. They run the
 * Asyncify build of MicroPython (src/sim/support.js), chosen by the page's own
 * feature test. Run after `npm run build`:
 *   node tests/sim-engines.mjs                   WebKit and Firefox, desktop
 *   OCB_ENGINES=webkit OCB_DEVICE='iPad (gen 7) landscape' node tests/sim-engines.mjs
 * OCB_DEVICE takes a name from Playwright's device list: an iPad gives WebKit
 * the iPad's screen, touch and user agent (not its memory or GPU; see the
 * checklist in sim/README.md for what only a real iPad shows). A finger
 * dragged on the 3D view is tested only with OCB_ENGINES=chromium (which has
 * JSPI, so add OCB_SIM_VM=asyncify to run the fallback there too).
 * Needs `npx playwright install webkit firefox` (and their system libraries),
 * and for Firefox a display: run it under `xvfb-run -a` on a machine without one.
 */
import { spawn } from 'node:child_process'
import playwright from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const ENGINES = (process.env.OCB_ENGINES || 'webkit,firefox').split(',')
const DEVICE = process.env.OCB_DEVICE || null

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}
let server = null
if (!(await reachable(BASE))) {
  server = spawn('npx', ['vite', 'preview', '--port', new URL(BASE).port || '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 250))
}

const problems = []
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}${!ok && detail ? ` (${detail})` : ''}`)
  if (!ok) problems.push(`${label}${detail ? ` (${detail})` : ''}`)
}

// One board, on a fresh page: Simulate pressed (a click, or a tap on a touch
// device, as a person would), then wait until it is ready.
async function openBoard(context, kind, touch) {
  const page = await context.newPage()
  // WebKit reports a resize that settles over two frames as an error; it is
  // harmless (the spec's "loop completed with undelivered notifications").
  page.on('pageerror', (e) => { if (!/^ResizeObserver loop/.test(e.message)) problems.push(`${kind}: page error: ${e.message}`) })
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${kind}: console error: ${m.text()}`) })
  await page.addInitScript((k) => {
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', k)
  }, kind)
  await page.goto(`${BASE}?lang=en`, { waitUntil: 'networkidle' })
  const t0 = Date.now()
  if (touch) await page.tap('#btn-sim')
  else await page.click('#btn-sim')
  await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 60000 })
  const startMs = Date.now() - t0
  await page.evaluate(() => {
    window.__out = ''
    window.openCodeBot.device.addEventListener('data', (e) => { window.__out += new TextDecoder('latin1').decode(e.detail) })
  })
  return { page, startMs }
}

const out = (page) => page.evaluate(() => window.__out)
const waitOut = (page, re, timeout = 20000) =>
  page.waitForFunction((src) => new RegExp(src).test(window.__out), re.source, { timeout }).then(() => true, () => false)
async function run(page, code) {
  await page.evaluate((c) => { window.__out = ''; return window.openCodeBot.device.run(c) }, code)
}
async function stopped(page) {
  await page.evaluate(() => window.openCodeBot.device.stop())
  return page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).then(() => true, () => false)
}

for (const name of ENGINES) {
  const engine = playwright[name]
  let browser
  try {
    // Headless Firefox on a machine with no GPU allows no WebGL; with a display
    // (xvfb-run) it draws in software, as it would on a school computer.
    const headless = !(name === 'firefox' && process.env.DISPLAY)
    browser = await engine.launch({ headless, ...(name === 'chromium' && process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {}) })
  } catch (e) {
    check(false, `${name}: launches`, e.message.split('\n')[0])
    continue
  }
  const device = DEVICE ? playwright.devices[DEVICE] : null
  if (DEVICE && !device) throw new Error(`no Playwright device "${DEVICE}"`)
  // Firefox takes no isMobile; an iPad is WebKit's.
  const { isMobile, ...firefoxSafe } = device ?? {}
  const context = await browser.newContext(device ? (name === 'firefox' ? firefoxSafe : device) : { viewport: { width: 1280, height: 800 } })
  if (process.env.OCB_SIM_VM === 'asyncify') await context.addInitScript(() => { delete WebAssembly.Suspending; delete WebAssembly.promising })
  const touch = !!device?.hasTouch
  console.log(`${name} ${browser.version()}${DEVICE ? `, as ${DEVICE}` : ''}`)

  // CodeBot: which build, time, input(), a button, Stop.
  const { page, startMs } = await openBoard(context, 'codebot', touch)
  const jspi = await page.evaluate(() => typeof WebAssembly.Suspending === 'function')
  const vm = await page.evaluate(() => window.openCodeBot.device.sim.vm)
  check(vm === (jspi ? 'jspi' : 'asyncify'), `it runs the ${jspi ? 'JSPI' : 'Asyncify'} build, chosen by testing for JSPI`, `running ${vm}`)
  console.log(`      Simulate to ready: ${startMs} ms`)

  {
    const t = Date.now()
    await run(page, "print('hello' + ' there')")
    check(await waitOut(page, /hello there/), 'a first program prints')
    console.log(`      first program, from Run to its output (MicroPython fetched and started): ${Date.now() - t} ms`)
  }
  {
    const t = Date.now()
    await run(page, 'import time\nt = time.monotonic()\ntime.sleep(1.5)\nprint("slept", round(time.monotonic() - t, 2))')
    const ok = await waitOut(page, /slept 1\.5\b/)
    const wall = Date.now() - t
    check(ok && wall > 1300, 'time.sleep(1.5) sleeps 1.5 simulated seconds, at the pace of the wall clock', `${await out(page)} after ${wall} ms`)
  }
  {
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => {})
    await run(page, 'name = input("Name? ")\nprint("Hello,", name)')
    const asked = await waitOut(page, /Name\? $/)
    await page.evaluate(() => window.openCodeBot.device.sendRaw('Jill\r'))
    check(asked && await waitOut(page, /Hello, Jill/), "input() waits for a line typed at the terminal", JSON.stringify(await out(page)))
  }
  {
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => {})
    await run(page, 'from botcore import *\nimport time\nprint("waiting")\nwhile not buttons.was_pressed(0):\n    time.sleep(0.02)\nprint("pressed")')
    await waitOut(page, /waiting/)
    await page.waitForTimeout(300)
    await page.evaluate(() => window.openCodeBot.device.sim.press(0, true))
    await page.waitForTimeout(100)
    await page.evaluate(() => window.openCodeBot.device.sim.press(0, false))
    check(await waitOut(page, /pressed/), 'a program waiting on a button goes on when it is pressed')
  }
  {
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 5000 }).catch(() => {})
    await run(page, 'import time\nprint("long")\ntime.sleep(60)\nprint("woke")')
    await waitOut(page, /long/)
    const t = Date.now()
    const ok = await stopped(page)
    check(ok && Date.now() - t < 2000, 'Stop ends a program in the middle of a sleep', `${Date.now() - t} ms`)
    await run(page, 'name = input("Name? ")')
    await waitOut(page, /Name\? $/)
    check(await stopped(page), 'Stop ends a program waiting in input()')
    await run(page, "print(6 * 7)")
    check(await waitOut(page, /42/), 'and the next program runs')
  }
  // The CPU and the suspensions, flat out (simulated time unpaced).
  {
    await page.evaluate(() => window.openCodeBot.device.sim.setSpeed(Infinity))
    const bench = async (code, mark) => {
      const times = []
      for (let i = 0; i < 3; i++) {
        await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 60000 }).catch(() => {})
        const t = Date.now()
        await run(page, code)
        await waitOut(page, new RegExp(mark), 300000)
        times.push(Date.now() - t)
      }
      return times.sort((a, b) => a - b)[1]
    }
    const cpu = await bench("def fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\ns = 0\nfor i in range(100000):\n    s += i * i % 7\nx = fib(20)\nprint('cpu' + 'done')", 'cpudone')
    const sleeps = await bench("import time\nfor i in range(2000):\n    time.sleep(0.001)\nprint('slp' + 'done')", 'slpdone')
    console.log(`      CPU-bound program: ${cpu} ms; 2,000 sleeps: ${sleeps} ms (median of 3)`)
    await page.evaluate(() => window.openCodeBot.device.sim.setSpeed(1))
    // At 1x, a program that never sleeps: does simulated time keep up with the
    // wall clock (as tests/perf.mjs asks of a Chromebook)? Reported, not judged:
    // this machine's software GL is not an iPad's GPU.
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 60000 }).catch(() => {})
    await run(page, 'from botcore import *\nmotors.enable(True)\nmotors.run(LEFT, 40)\nmotors.run(RIGHT, 60)\nn = 0\nwhile True:\n    n += 1\n')
    await page.waitForTimeout(1500)
    const pace = await page.evaluate(async () => {
      const d = window.openCodeBot.device.sim
      const s0 = d.lastFrame.t, w0 = performance.now()
      let frames = 0
      await new Promise((r) => { const f = () => { frames++; if (performance.now() - w0 < 4000) requestAnimationFrame(f); else r() }; requestAnimationFrame(f) })
      const w = performance.now() - w0
      return { simPerWall: (d.lastFrame.t - s0) / 1000 / w, fps: frames / (w / 1000) }
    })
    console.log(`      a busy program at 1x: ${pace.simPerWall.toFixed(2)} simulated seconds per wall second, ${pace.fps.toFixed(0)} frames a second`)
    await stopped(page)
  }
  // Sound: the Speaker's Web Audio started with the gesture that pressed
  // Simulate (Safari keeps it suspended otherwise).
  // A machine with no audio output (a CI runner) keeps every AudioContext
  // suspended, gesture or not: then a fresh one, made now, is suspended too,
  // and there is nothing to judge. Ours suspended while a fresh one runs is
  // the app's fault.
  {
    const sound = await page.evaluate(async () => {
      const ours = window.openCodeBot.device.sim.speaker?.ctx?.state
      if (ours === 'running') return { ours }
      const fresh = new AudioContext()
      await new Promise((r) => setTimeout(r, 1000))
      const state = fresh.state
      fresh.close()
      return { ours, fresh: state }
    })
    if (sound.ours !== 'running' && sound.fresh !== 'running') console.log(`  skip  the simulator's sound after Simulate: this machine plays no audio (a fresh AudioContext is ${sound.fresh} too)`)
    else check(sound.ours === 'running', 'the simulator\'s sound is running after Simulate was pressed', JSON.stringify(sound))
  }
  // The 3D view: WebGL, and what it may use.
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')
    const view = window.openCodeBot.device.sim.view
    return c && { version: c instanceof WebGL2RenderingContext ? 2 : 1, maxTexture: c.getParameter(c.MAX_TEXTURE_SIZE), ratio: view?.ratio, drawn: view?.renderer?.info?.render?.frame }
  })
  check(!!gl && gl.drawn > 0, 'the 3D view draws', JSON.stringify(gl))
  console.log(`      WebGL ${gl?.version}, textures up to ${gl?.maxTexture} px, pixel ratio ${gl?.ratio?.toFixed?.(2)}`)
  if (touch && name === 'chromium') {
    // A one-finger drag on the 3D view turns the camera, as a mouse drag does.
    // Real touch events need Chromium's DevTools protocol; Playwright's WebKit
    // can only tap, and the camera's controls capture the pointer, which a
    // synthetic event cannot. The touch handling is the page's own, the same
    // in every engine.
    const before = await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray())
    const box = await page.locator('canvas.sim-canvas').first().boundingBox()
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    const cdp = await context.newCDPSession(page)
    const touchAt = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: cy, id: 1 }] })
    await touchAt('touchStart', cx)
    for (let i = 1; i <= 10; i++) { await touchAt('touchMove', cx + i * 12); await page.waitForTimeout(16) }
    await touchAt('touchEnd')
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => window.openCodeBot.device.sim.view.camera.position.toArray())
    check(before.some((v, i) => Math.abs(v - after[i]) > 1e-3), 'a finger dragged on the 3D view turns the camera', `${before} to ${after}`)
  }
  if (touch) {
    // A tap on a toolbox category opens its blocks.
    const cat = page.locator('.blocklyToolboxCategory:visible').first()
    if (await cat.count()) {
      await cat.tap()
      await page.waitForTimeout(400)
      check(await page.locator('.blocklyFlyout').first().isVisible(), 'a tap on a toolbox category opens its blocks')
    }
  }
  await page.close()

  // CodeX: audio.mp3 blocks for the recording's length.
  {
    const { page } = await openBoard(context, 'codex', touch)
    await run(page, 'from codex import *\nimport time\nt = time.monotonic()\naudio.mp3("sounds/welcome")\nprint("after", round(time.monotonic() - t, 1))')
    const ok = await waitOut(page, /after \d/)
    const said = await out(page)
    const secs = +(said.match(/after ([\d.]+)/)?.[1] ?? 0)
    check(ok && secs > 1.5, 'CodeX: audio.mp3() waits for the recording\'s length', said)
    await page.close()
  }

  // CodeAIR: it takes off, and Stop lands it.
  {
    const { page } = await openBoard(context, 'codeair', touch).catch(() => ({ page: null }))
    if (!page) check(false, 'CodeAIR: the simulator starts')
    else {
      await run(page, 'from codeair import *\nfrom flight import *\nfly.take_off(0.5)\nwhile True:\n    fly.turn_left(90)\n')
      const up = await page.waitForFunction(() => (window.openCodeBot.device.sim.lastFrame?.devices[0]?.z ?? 0) > 0.3, null, { timeout: 30000 }).then(() => true, () => false)
      check(up, 'CodeAIR takes off', JSON.stringify(await page.evaluate(() => window.openCodeBot.device.sim.lastFrame?.devices[0]?.z)))
      await stopped(page)
      const down = await page.waitForFunction(() => (window.openCodeBot.device.sim.lastFrame?.devices[0]?.z ?? 1) < 0.05, null, { timeout: 30000 }).then(() => true, () => false)
      check(down, 'and Stop lands it')
      await page.close()
    }
  }
  await browser.close()
}
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
