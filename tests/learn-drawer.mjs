/**
 * The mission drawer and its rail, at the screens students use (a Chromebook,
 * a laptop, iPads across and upright): nothing runs off the side, the program
 * keeps its room, the drawer lies over the simulator and the terminal (not the
 * program or its Blocks/Python switch), and it opens and closes by mouse,
 * touch and keyboard, from the rail's button or its steps. It also keeps its
 * state across a reload.
 * Run after `npm run build`.
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

const objective = (id, title) => ({ type: 'objective', id, title, instructions: `About ${title}.`, goals: [{ md: 'Run it', check: { runs: true } }] })
const PACK = {
  format: 1,
  id: 'DRAWER',
  title: 'Drawer pack',
  brief: 'For the tests',
  board: 'codebot',
  missions: [
    {
      id: 'DRAWER_M',
      title: 'Lights',
      brief: 'Turn them on',
      flow: [
        objective('DRAWER_1', 'First'),
        { type: 'quiz', id: 'DRAWER_Q', title: 'Checkpoint', questions: [{ id: 'DRAWER_Q1', q: 'Which?', answers: [{ a: 'This', correct: true }, { a: 'That' }] }] },
        objective('DRAWER_2', 'Second'),
      ],
    },
  ],
}

// [name, width, height, touch]
const SIZES = [
  ['Chromebook 1366x768', 1366, 768, false],
  ['laptop 1280x800', 1280, 800, false],
  ['iPad 1024x768', 1024, 768, true],
  ['iPad Air 1180x820', 1180, 820, true],
  ['iPad upright 768x1024', 768, 1024, true],
]

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})

for (const [name, width, height, touch] of SIZES) {
  console.log(name)
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch })
  const page = await context.newPage()
  page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`))
  await page.goto(`${BASE}?device=loopback`, { waitUntil: 'networkidle' })
  await page.evaluate(() => {
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)

  const press = (sel) => (touch ? page.tap(sel) : page.click(sel))
  const drawer = () => page.evaluate(() => document.querySelector('.workarea').dataset.drawer)
  const settled = () => page.waitForTimeout(350) // the slide
  const box = (sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  }, sel)

  await page.setInputFiles('#pack-input', { name: 'drawer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(PACK)) })
  await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))
  check((await drawer()) === 'open', 'a pack opens with its drawer out')
  await press('#learn-pane [data-mission="0"]')
  await press('#learn-pane [data-learn="next"]')
  await settled()

  // The layout, drawer out.
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scrolling')
  const rail = await box('#learn-rail')
  const pane = await box('#learn-pane')
  const blocks = await box('#blocks-pane')
  check(rail.right <= width + 0.5 && rail.width >= 44 && rail.width <= 64, `the rail is at the right edge, ${Math.round(rail.width)}px wide`)
  check(pane.right <= rail.left + 0.5 && pane.left >= 0 && pane.width >= 300, `the drawer is beside the rail, ${Math.round(pane.width)}px wide`)
  check(blocks.width >= 280, `the program keeps its room (${Math.round(blocks.width)}px)`)
  if (width > 880) {
    const side = await box('#side-pane')
    const view = await box('#btn-view')
    check(Math.abs(pane.left - side.left) <= 8, 'the drawer lies over the simulator and the terminal')
    check(view.right <= pane.left, 'the Blocks/Python switch stays in view')
  }
  check((await page.getAttribute('#learn-rail [data-rail-step="0"]', 'aria-current')) === 'step', 'the rail marks the step on show')
  check((await page.locator('#learn-rail .rail-step').allInnerTexts()).join(' ') === '1 ? 3', 'one rail button per step, a quiz as ?')

  // Put away, from the rail's button.
  await press('#learn-rail .rail-toggle')
  await settled()
  check((await drawer()) === 'closed', `${touch ? 'a tap' : 'a click'} on the rail's button puts the drawer away`)
  check(await page.evaluate(() => {
    const p = document.getElementById('learn-pane')
    return p.inert && getComputedStyle(p).visibility === 'hidden' && p.getBoundingClientRect().left >= document.getElementById('learn-rail').getBoundingClientRect().left
  }), 'out of sight and out of reach')
  check((await page.getAttribute('#learn-rail .rail-toggle', 'aria-expanded')) === 'false', 'the button says it is closed')
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'still no sideways scrolling')

  // A step on the rail opens the drawer at that step; the step on show puts it away again.
  await press('#learn-rail [data-rail-step="1"]')
  await settled()
  check((await drawer()) === 'open' && (await page.locator('#learn-pane .learn-title').innerText()) === 'Checkpoint', 'a step on the rail opens the drawer at that step')
  check((await page.getAttribute('#learn-rail [data-rail-step="1"]', 'aria-current')) === 'step', 'and the rail follows')
  await press('#learn-rail [data-rail-step="1"]')
  await settled()
  check((await drawer()) === 'closed', 'the step on show, pressed again, puts the drawer away')
  await press('#learn-rail .rail-chevron')
  await settled()
  check((await drawer()) === 'open', 'the chevron brings it back')

  // Remembered in this browser.
  await press('#learn-rail .rail-toggle')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
  check((await drawer()) === 'closed' && (await page.getAttribute('#learn-rail [data-rail-step="1"]', 'aria-current')) === 'step', 'after a reload, put away and at the same step')

  if (name.startsWith('Chromebook')) {
    console.log('Keyboard')
    await page.focus('#learn-rail .rail-toggle')
    await page.keyboard.press('Enter')
    await settled()
    check((await drawer()) === 'open', 'Enter on the rail\'s button brings the drawer out')
    check(await page.evaluate(() => document.getElementById('learn-pane').contains(document.activeElement)), 'and takes the student into it')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Escape')
    await settled()
    check((await drawer()) === 'closed', 'Escape in the drawer puts it away')
    check(await page.evaluate(() => document.activeElement?.classList.contains('rail-toggle')), 'and the student is back on the rail\'s button')
    let leaked = false
    for (let i = 0; i < 6 && !leaked; i++) {
      await page.keyboard.press('Shift+Tab')
      leaked = await page.evaluate(() => document.getElementById('learn-pane').contains(document.activeElement))
    }
    check(!leaked, 'Shift+Tab from the rail never lands in a drawer that is put away')
    await page.focus('#learn-rail [data-rail-step="2"]')
    await page.keyboard.press('Enter')
    await settled()
    check((await drawer()) === 'open' && (await page.locator('#learn-pane .learn-title').innerText()) === 'Second', 'Enter on a step opens the drawer there')
    check(
      (await page.getAttribute('#learn-rail [data-rail-step="2"]', 'aria-label')).includes('Second') && (await page.getAttribute('#learn-rail .rail-toggle', 'aria-label')).length > 0,
      'the rail\'s buttons have names',
    )
  }
  await context.close()
}

await browser.close()
server?.kill()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
