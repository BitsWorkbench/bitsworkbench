/**
 * Mission journeys in the app (docs/mission-packs.md, "Journeys"): a journey
 * opens from the drawer, its coach points at the real controls and blocks,
 * each step is met by doing it (the camera turned, a run, a field edited, a
 * category opened, a block added, a question answered), progress survives a
 * reload, switching mode pauses it, and a chapter can be started over from its
 * program. At the screens students use, nothing runs off the side and the
 * bubble stays on screen. Run after `npm run build`.
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

const START = 'from codex import *\n\ndisplay.show("Hi there!")\n'
export const PACK = {
  format: 1,
  id: 'JOURNEY',
  title: 'Journey pack',
  brief: 'For the tests',
  board: 'codex',
  missions: [
    {
      id: 'JOURNEY_M',
      title: 'Hello CodeX',
      brief: 'Say hello',
      flow: [
        {
          type: 'journey',
          id: 'JOURNEY_J',
          title: 'Hello',
          promise: 'Make CodeX say your name and light up.',
          chapters: [
            {
              id: 'JOURNEY_C1',
              title: 'Say it',
              code: START,
              steps: [
                { id: 'J_look', say: 'Drag CodeX to spin it around.', point: 'sim', do: { event: 'orbit' }, skippable: true },
                { id: 'J_run', say: 'Press **Run**.', point: 'run', do: { runs: true }, cheer: 'It ran!', fx: ['beam block:display.show(...) > part:^LCD_Shield$', 'zoom part:^LCD_Shield$'] },
                {
                  id: 'J_name',
                  say: 'Click **Hi there!** and type your name.',
                  point: 'field:display.show(...)',
                  do: { all: [{ has: 'display.show(...)' }, { has: "display.show('Hi there!')", max: 0 }] },
                  hints: ['Click the words in the blue block.'],
                },
              ],
            },
            {
              id: 'JOURNEY_C2',
              title: 'Light it',
              code: 'from codex import *\n\ndisplay.show("Hi, I\'m Sam!")\n',
              fresh: true,
              steps: [
                { id: 'J_palette', say: 'Open **Lights**.', point: 'palette:lights', do: { event: 'palette', name: 'lights' } },
                { id: 'J_add', say: 'Drag **set all neopixels** under your show block.', point: 'palette-item:pixels.fill(...)', palette: 'lights', to: 'after:display.show(...)', do: { has: 'pixels.fill(...)' }, fx: ['ghost', 'pulse part:^Neo_', 'morph'], show: { card: 'compare', caption: 'Each block is a line of Python.' } },
                { id: 'J_ask', ask: 'Which line lights CodeX up?', answers: [{ a: '`display.show(...)`' }, { a: '`pixels.fill(...)`', correct: true }] },
              ],
            },
          ],
          complete: 'You made CodeX say your name and light up.',
        },
        { type: 'objective', id: 'JOURNEY_After', title: 'After', instructions: 'Next.', goals: [{ md: 'Run it', check: { runs: true } }] },
      ],
    },
  ],
}

const SIZES = [
  ['Chromebook 1366x768', 1366, 768, false],
  ['iPad 1024x768', 1024, 768, true, 'reduce'],
  ['iPad upright 768x1024', 768, 1024, true],
]

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
for (const [name, width, height, touch, motion = 'no-preference'] of SIZES) {
  const reduced = motion === 'reduce'
  console.log(`${name}${reduced ? ', reduced motion' : ''}`)
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, reducedMotion: motion })
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codex')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
  // The program the journey starts from, and the simulator up.
  await page.evaluate((py) => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython(py).state)
  }, START)
  if (!/stop/i.test(await page.innerText('#btn-sim'))) await page.click('#btn-sim')
  await page.waitForFunction(() => !!window.openCodeBot.device.sim.view?.partBox, null, { timeout: 20000 })

  await page.setInputFiles('#pack-input', { name: 'journey.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PACK)) })
  await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))
  await page.click('#learn-pane [data-mission="0"]')
  await page.click('#learn-pane [data-learn="next"]')
  check((await page.locator('#learn-pane .learn-title').innerText()) === 'Hello', 'the drawer shows the journey')
  await page.click('#learn-pane [data-learn="journey"]')
  await page.waitForTimeout(400)
  check((await page.evaluate(() => document.querySelector('.workarea').dataset.drawer)) === 'closed', 'starting it puts the drawer away')
  check(await page.locator('.journey-centre h2').isVisible(), 'an opening card over the simulator')
  // The journey begins from its first chapter's program; the student's own, being different, is kept.
  await page.evaluate(() => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython('from codex import *\n\ndisplay.show("Mine")\n').state)
  })
  await page.click('.journey-centre [data-journey="begin"]')
  check(await page.waitForSelector('#modal[open]', { timeout: 3000 }).then(() => true, () => false), 'beginning asks before replacing a different program')
  await page.click('#modal[open] button[value="ok"]')
  await page.waitForTimeout(600)
  check((await page.evaluate(() => window.openCodeBot._currentPython())).includes('Hi there!'), 'and begins from the first chapter\'s program')

  const bubble = () => page.locator('.journey-bubble')
  const ringOn = async (sel) =>
    page.evaluate((sel) => {
      const ring = document.querySelector('.journey-ring')
      const el = document.querySelector(sel)
      if (!ring || ring.hidden || !el) return false
      const a = ring.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      return a.left <= b.left + 2 && a.right >= b.right - 2 && a.top <= b.top + 2 && a.bottom >= b.bottom - 2
    }, sel)
  const onScreen = () =>
    page.evaluate(() => {
      const r = document.querySelector('.journey-bubble').getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
    })
  const next = async () => {
    await page.click('.journey-bubble [data-journey="next"]')
    await page.waitForTimeout(350)
  }

  // 1: turn the camera
  check(await ringOn('#side-pane canvas'), 'step 1 rings the simulator')
  check(await onScreen(), 'the bubble is on screen')
  const c = await page.locator('#side-pane canvas').boundingBox()
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width / 2 + 80, c.y + c.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  check(await bubble().evaluate((b) => b.classList.contains('good')), 'turning the camera meets it')
  check(await page.evaluate(() => document.activeElement?.dataset?.journey === 'next'), 'and Next has the focus')
  await next()

  // 2: run
  check(await ringOn('#btn-run'), 'step 2 rings Run')
  await page.click('#btn-run')
  await page.waitForFunction(() => document.querySelector('.journey-bubble')?.classList.contains('good'), null, { timeout: 15000 }).catch(() => {})
  check(await bubble().evaluate((b) => b.classList.contains('good')), 'running meets it')
  await page.waitForTimeout(400)
  check(await page.locator('.journey-fx-beam path').count() >= 1, 'a beam from the block to the screen')
  check(await page.locator('.journey-fx-lens canvas').count() === 1, 'and a magnifier on the screen')
  await next()

  // 3: the field, by its ring; a hint on request
  const ring = await page.locator('.journey-ring').boundingBox()
  check(!!ring && ring.width < 200, 'step 3 rings the text field, not the whole block')
  await page.click('.journey-bubble [data-journey="hint"]')
  check(await page.locator('.journey-hint').isVisible(), 'a hint on request')
  await page.evaluate(() => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython('from codex import *\n\ndisplay.show("Hi, I\'m Sam!")\n').state)
  })
  await page.waitForTimeout(900)
  check(await bubble().evaluate((b) => b.classList.contains('good')), 'changing the words meets it')

  // A reload in the middle comes back to the next step.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
  await page.waitForSelector('.journey-bubble:not([hidden])', { timeout: 10000 }).catch(() => {})
  check((await page.locator('.journey-n').first().innerText().catch(() => '')).includes('4'), 'after a reload, the guide comes back at step 4')
  if (!/stop/i.test(await page.innerText('#btn-sim'))) await page.click('#btn-sim')

  // 4: the Lights category
  await page.waitForTimeout(400)
  const lights = page.locator('.blocklyToolboxCategory:has-text("Lights")').first()
  await lights.click()
  await page.waitForTimeout(400)
  check(await bubble().evaluate((b) => b.classList.contains('good')), 'opening Lights meets it')
  await next()

  // 5: the block in the flyout
  const flyoutRinged = await page.evaluate(() => {
    const ring = document.querySelector('.journey-ring').getBoundingClientRect()
    const fly = document.querySelector('.blocklyFlyout').getBoundingClientRect()
    return ring.left >= fly.left - 12 && ring.right <= fly.right + 40
  })
  check(flyoutRinged, 'step 5 rings a block in the open Lights flyout')
  await page.waitForTimeout(700)
  check(await page.locator('.journey-fx-ghost svg').count() === 1 && await page.locator('.journey-fx-slot').count() === 1, 'the block\'s ghost and the slot where it goes')
  check((await page.locator('.journey-fx-hand').count()) === (reduced ? 0 : 1), reduced ? 'no hand under reduced motion' : 'a hand carries it')
  if (reduced) check(await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.journey-fx')).length === 0), 'nothing in the effects moves')
  await page.click('.journey-bubble [data-journey="show-me"]')
  await page.waitForTimeout(300)
  check(await page.locator('.journey-fx-ghost').count() === 1, 'Show me plays it again')
  await page.evaluate(() => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython('from codex import *\n\ndisplay.show("Hi, I\'m Sam!")\npixels.fill(RED)\n').state)
  })
  await page.waitForTimeout(900)
  check(await bubble().evaluate((b) => b.classList.contains('good')), 'adding the block meets it')
  check(await page.locator('.journey-fx-ghost').count() === 0, 'the ghost goes once it is met')
  check(await page.locator('.journey-fx-glow').count() === 4, 'each NeoPixel glows')
  check(await page.locator('.journey-fx-morph').count() === 2, 'each block lights in turn')
  check((await page.locator('.journey-card .journey-code').innerText()).includes('pixels.fill(RED)'), 'the compare card shows the program as Python')
  await page.waitForTimeout(300)
  check(await page.evaluate(() => {
    const next = document.querySelector('.journey-bubble [data-journey="next"]').getBoundingClientRect()
    return document.elementFromPoint(next.x + next.width / 2, next.y + next.height / 2)?.closest('[data-journey="next"]') !== null
  }), 'the card leaves the bubble\'s Next uncovered')
  await next()

  // Switching mode pauses; switching back carries on.
  await page.click('#btn-view')
  await page.waitForTimeout(500)
  check(await page.locator('.journey-centre [data-journey="switch-back"]').isVisible(), 'switching to Python pauses the guide')
  await page.click('.journey-centre [data-journey="switch-back"]')
  await page.waitForTimeout(600)
  check(await bubble().isVisible(), 'switching back carries on')

  // 6: the question
  await page.click('.journey-answers [data-value="0"]')
  check(await page.locator('.journey-again').isVisible(), 'a wrong answer says try again')
  await page.click('.journey-answers [data-value="1"]')
  await next()
  check((await page.locator('.journey-centre h2').innerText()).includes('Mission complete'), 'the finish card')
  check((await page.locator('.journey-fx-confetti').count() > 0) === !reduced, reduced ? 'no confetti under reduced motion' : 'confetti')
  await page.click('.journey-centre [data-journey="finish"]')
  await page.waitForTimeout(500)
  check((await page.locator('#learn-pane .learn-title').innerText()) === 'After', 'Next goes on to what follows, in the drawer')
  check((await page.getAttribute('#learn-rail [data-rail-step="0"]', 'data-done')) === 'true', 'the rail shows the journey done')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scrolling')

  // A chapter started over loads its program, but never loses the student's:
  // when theirs differs, it asks; keeping working changes nothing; starting
  // over keeps theirs as a file beside it first.
  const python = () => page.evaluate(() => window.openCodeBot._currentPython())
  const browserFiles = () => page.evaluate(async () => {
    const store = window.openCodeBot.stores.browser
    const out = {}
    for (const e of await store.list('')) if (e.kind === 'file') out[e.path] = await store.read(e.path)
    return out
  })
  const filesBefore = Object.keys(await browserFiles())
  await page.click('#learn-rail [data-rail-step="0"]')
  await page.click('#learn-pane [data-learn="journey"][data-chapter="1"]')
  await page.waitForTimeout(500)
  check(await page.locator('#modal[open]').isVisible(), 'starting a chapter over asks first, the program being different')
  await page.click('#modal[open] button[value="cancel"]')
  await page.waitForTimeout(400)
  check((await python()).includes('pixels.fill'), 'keeping working leaves the program as it was')
  check(await page.isVisible('#learn-pane [data-learn="journey"][data-chapter="1"]'), 'and the drawer where it was')
  await page.click('#learn-pane [data-learn="journey"][data-chapter="1"]')
  await page.waitForSelector('#modal[open]')
  await page.click('#modal[open] button[value="ok"]')
  await page.waitForTimeout(700)
  const py = await python()
  check(py.includes("Hi, I'm Sam!") && !py.includes('pixels.fill'), 'starting chapter 2 over loads its program')
  check((await page.locator('.journey-n').first().innerText()).includes('4'), 'and points at its first step')
  const files = await browserFiles()
  const kept = Object.keys(files).filter((p) => !filesBefore.includes(p))
  check(kept.length === 1 && files[kept[0]].includes('pixels.fill(RED)'), `the program before is kept as a file (${kept.join(', ')})`)
  check(kept.every((p) => /^[A-Za-z_][A-Za-z0-9_]*\.py$/.test(p)), 'named so a board takes it (letters, digits and _)')
  // The same chapter again, the program now its start: nothing to keep, nothing asked.
  await page.click('#learn-rail [data-rail-step="0"]')
  await page.click('#learn-pane [data-learn="journey"][data-chapter="1"]')
  await page.waitForTimeout(500)
  check(!(await page.locator('#modal[open]').isVisible()), 'no question when the program is already the chapter\'s start')
  check(Object.keys(await browserFiles()).length === kept.length + filesBefore.length, 'and no file kept')
  // Programs that differ only by a comment, or by a line's indentation, are different: it asks.
  const asks = async (now, chapter) => {
    await page.evaluate((py) => {
      const app = window.openCodeBot
      app.workspace.replaceBlocks(app.blocksFromPython(py).state)
    }, now)
    const answer = page.evaluate((py) => window.openCodeBot._startOver(py), chapter)
    const asked = await page.waitForSelector('#modal[open]', { timeout: 2000 }).then(() => true, () => false)
    if (asked) await page.click('#modal[open] button[value="cancel"]')
    return asked && (await answer) === false
  }
  const loop = 'from codex import *\n\nwhile True:\n    display.show("a")\n    pixels.off()\n'
  check(await asks(loop, loop.replace('    pixels.off()', 'pixels.off()')), 'a line moved out of a loop is a different program')
  check(await asks(loop, `${loop}# my note\n`), 'so is one with a comment of its own')
  // Next into a `fresh` chapter starts it from its program, the student's kept.
  await page.evaluate(() => {
    const app = window.openCodeBot
    app.workspace.replaceBlocks(app.blocksFromPython('from codex import *\n\ndisplay.show("Mine")\n').state)
    const j = app.learn.journey
    j.index = j.steps.findIndex((s) => s.chapter === 1) - 1
    j._action({ action: 'next' })
  })
  check(await page.waitForSelector('#modal[open]', { timeout: 3000 }).then(() => true, () => false), 'Next into a fresh chapter asks before replacing a different program')
  await page.click('#modal[open] button[value="ok"]')
  await page.waitForTimeout(600)
  check((await python()).includes("Hi, I'm Sam!"), 'and starts the chapter from its program')
  await context.close()
}
await browser.close()
server?.kill()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
