/**
 * Guided packs (docs/mission-packs.md, "Guided packs"): a pack whose every
 * mission is one journey opens with no drawer. The student chooses once how
 * its missions run, and the pack's board comes up in the simulator; Learn
 * becomes Exit tutorial; the rail shows the mission and its objectives (the
 * journey's chapters), done, open or locked; a locked one warns, then unlocks
 * only the next; the controller puts the simulator back when the student
 * closes it; a reload comes back to the step without asking again; and the
 * missions card lists the missions, locked ones warning the same way. At a
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

const SAY = 'from codex import *\n\ndisplay.show("Hi there!")\n'
const run = (id) => ({ id, say: 'Press **Run**.', point: 'run', do: { runs: true }, cheer: 'It ran!' })
const journey = (m, chapters) => ({
  type: 'journey',
  id: `GUIDED_${m}_J`,
  title: `Journey ${m}`,
  promise: `Mission ${m}'s promise.`,
  chapters,
  complete: `Mission ${m} done.`,
})
export const PACK = {
  format: 1,
  id: 'GUIDED',
  title: 'Guided pack',
  brief: 'For the tests',
  board: 'codex',
  complete: 'Every mission done.',
  missions: [
    {
      id: 'GUIDED_M1',
      title: 'First',
      brief: 'The first mission',
      flow: [journey(1, [
        { id: 'GUIDED_1_C1', title: 'Run it', code: SAY, steps: [run('G_1_run')] },
        { id: 'GUIDED_1_C2', title: 'Look at it', steps: [{ id: 'G_1_look', say: 'Click the screen.', point: 'part:^LCD_Shield$', do: { pick: '^LCD_Shield$' } }, run('G_1_run2')] },
        { id: 'GUIDED_1_C3', title: 'Talk to it', steps: [{ id: 'G_1_term', say: 'This is the terminal.', point: 'terminal', do: { event: 'switched' }, skippable: true }] },
      ])],
    },
    {
      id: 'GUIDED_M2',
      title: 'Second',
      brief: 'The second mission',
      flow: [journey(2, [{ id: 'GUIDED_2_C1', title: 'Again', code: SAY, steps: [run('G_2_run')] }])],
    },
  ],
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
  await page.goto(BASE, { waitUntil: 'networkidle' })
  // A CodeBot picked, and no simulator: the pack brings up its own board.
  await page.evaluate(() => {
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
  const modal = (value) => page.waitForSelector(`#modal[open] button[value="${value}"]`, { timeout: 4000 }).then(() => true, () => false)
  const state = () => page.evaluate(() => {
    const app = window.openCodeBot
    const rail = [...document.querySelectorAll('#learn-rail [data-rail-chapter]')]
    return {
      drawer: getComputedStyle(document.getElementById('learn-pane')).display !== 'none',
      learn: document.querySelector('#btn-learn .btn-text').textContent,
      sim: app.device.simulating,
      board: app.device.targetId,
      chapters: rail.map((b) => (b.dataset.locked === 'true' ? 'locked' : b.dataset.done === 'true' ? 'done' : 'open')),
      current: rail.findIndex((b) => b.getAttribute('aria-current') === 'step'),
      mission: app.learn.tutorial.place?.mission,
      index: app.learn.journey.index,
      railShown: !document.getElementById('learn-rail').hidden,
    }
  })
  const onScreen = (sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el || el.hidden) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
  }, sel)
  const pressRun = async () => {
    await page.waitForSelector('#btn-run:not([hidden]):not([disabled])', { timeout: 15000 })
    await page.click('#btn-run')
    await page.waitForSelector('.journey-bubble.good', { timeout: 20000 })
  }

  // Work from before mission files: main.py open, and a main_saved.py beside it. Nothing may touch them.
  const OLD = { 'main.py': 'from codex import *\n\ndisplay.show("Theirs")\n', 'main_saved.py': 'print("kept before")\n' }
  await page.evaluate(async (old) => {
    const app = window.openCodeBot
    for (const [path, text] of Object.entries(old)) await app.stores.browser.write(path, text)
    await app._openRef({ store: 'browser', path: 'main.py' })
  }, OLD)
  const oldFiles = () => page.evaluate(async (names) => Promise.all(names.map((n) => window.openCodeBot.stores.browser.read(n).catch(() => null))), Object.keys(OLD))

  await page.setInputFiles('#pack-input', { name: 'guided.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PACK)) })
  check(await modal('choice:sim'), 'opening a guided pack asks how its missions run')
  await page.click('#modal[open] button[value="choice:sim"]')
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 30000 })
  let s = await state()
  check(!s.drawer, 'no drawer')
  check(s.sim && s.board === 'codex', `the pack's board comes up in the simulator (${s.board})`)
  check(s.learn === 'Exit tutorial', 'Learn says Exit tutorial')
  check(s.railShown && s.chapters.join() === 'open,locked,locked', `the rail: the first objective open, the rest locked (${s.chapters})`)
  check(await onScreen('.journey-centre'), 'the opening card is on screen')

  await page.click('.journey-centre [data-journey="begin"]')
  await page.waitForSelector('.journey-bubble:not([hidden])')
  check(!(await page.evaluate(() => document.getElementById('modal').open)), 'beginning asks nothing about files')
  check((await page.evaluate(() => window.openCodeBot.openFile.path)) === 'journey_1/journey_1.py', 'the mission works in a file named for it, in a folder of its own')
  check((await state()).current === 0, 'the first objective is the current one')
  await pressRun()
  check(await onScreen('.journey-bubble [data-journey="next"]'), 'Next is on screen')
  await page.click('.journey-bubble [data-journey="next"]')
  await page.waitForTimeout(400)
  s = await state()
  check(s.chapters.join() === 'done,open,locked' && s.current === 1, `one done, the next open and current (${s.chapters}, at ${s.current})`)

  // A locked objective: warned; Back keeps the place.
  await page.click('#learn-rail [data-rail-chapter="2"]')
  check(await modal('choice:back'), 'a locked objective warns first')
  await page.click('#modal[open] button[value="choice:back"]')
  await page.waitForTimeout(300)
  check((await state()).current === 1, 'and keeping in order stays where the student was')

  // The controller has the screen: the simulator closed comes back.
  await page.click('#btn-sim')
  await page.waitForFunction(() => window.openCodeBot.device.simulating, null, { timeout: 20000 }).catch(() => {})
  check((await state()).sim, 'the simulator closed during a mission comes back')
  const ringBack = await page.waitForFunction(() => !document.querySelector('.journey-ring').hidden, null, { timeout: 10000 }).then(() => true, () => false)
  if (!ringBack) console.log(await page.evaluate(() => { const j = window.openCodeBot.learn.journey; return JSON.stringify({ i: j.index, point: j.steps[j.index]?.point, found: !!j._locate(j.steps[j.index]), view: !!window.openCodeBot.device.sim.view, good: j.coach?.good, folded: j.coach?.folded }) }))
  check(ringBack, 'and the ring is on the board again')

  // Unlock: only the next one.
  await page.click('#learn-rail [data-rail-chapter="2"]')
  await modal('choice:unlock')
  await page.click('#modal[open] button[value="choice:unlock"]')
  await page.waitForTimeout(600)
  s = await state()
  check(s.chapters[2] === 'open' && s.current === 2, `unlocking opens it and goes there (${s.chapters}, at ${s.current})`)
  check(await page.evaluate(() => document.getElementById('side-pane').dataset.term === 'open'), 'a step about the terminal opens it')

  // Back to a done objective: its steps show done, with Next.
  await page.click('#learn-rail [data-rail-chapter="0"]')
  await page.waitForTimeout(600)
  check((await state()).current === 0 && (await page.locator('.journey-bubble .journey-before').count()) === 1, 'a done objective can be visited, its step marked done with Next')

  // A reload comes back to the step, without asking again.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('.journey-bubble:not([hidden]), .journey-centre:not([hidden])', { timeout: 30000 })
  check(!(await page.evaluate(() => document.getElementById('modal').open)), 'after a reload, nothing asks how missions run again')
  s = await state()
  check(s.sim && s.railShown && s.learn === 'Exit tutorial', 'the simulator, the rail and Exit tutorial are back')

  // The missions card: the second mission is locked until the first is done.
  await page.click('#learn-rail .rail-mission')
  await page.waitForSelector('#modal[open] [data-guide-mission]')
  check((await page.locator('#modal [data-guide-mission="1"]').getAttribute('data-state')) === 'locked', 'the missions card shows the next mission locked')
  await page.click('#modal [data-guide-mission="1"]')
  check(await modal('choice:unlock'), 'and picking it warns first')
  await page.click('#modal[open] button[value="choice:unlock"]')
  await page.waitForSelector('.journey-centre [data-journey="begin"]', { timeout: 15000 })
  check((await state()).mission === 1, 'unlocking goes to it, at its opening card')

  await page.click('#btn-learn')
  await page.waitForTimeout(400)
  s = await state()
  check(!s.railShown && s.learn === 'Learn' && !(await page.locator('.journey-layer').count()), 'Exit tutorial leaves: no rail, no coach, Learn again')
  check(JSON.stringify(await oldFiles()) === JSON.stringify(Object.values(OLD)), 'main.py and main_saved.py from before are just as they were')
  await context.close()
}
await browser.close()
server?.kill()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
