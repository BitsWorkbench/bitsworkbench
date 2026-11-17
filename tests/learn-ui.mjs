/**
 * Learn's mission packs in the app: a pack file opens from Learn into the
 * tutorial pane, its steps go forward and back, its text follows the
 * blocks/Python switch, a quiz marks answers, the place survives a reload, a
 * broken pack is refused with its problem named, a pack's second file joins
 * it, and closing the pane gives the side its room back.
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

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const objective = (id, title, more = {}) => ({
  type: 'objective',
  id,
  title,
  instructions: `--Concept--\nLEDs are **lights**.\n--/Concept--\n\nNow --Blocks--drag the block--/Blocks----Python--type the line--/Python-- in.\n\n![The LEDs](leds.png)`,
  code: 'from botcore import *\n',
  goals: [{ md: 'Light them all', check: { has: 'leds.user(0b11111111)' } }],
  hints: ['Look at the **CodeTrek**.'],
  ...more,
})
const PACK = {
  format: 1,
  id: 'UI',
  title: 'Test pack',
  brief: 'For the tests',
  overview: 'A pack for the tests.',
  board: 'codebot',
  assets: { 'leds.png': PNG },
  missions: [
    {
      id: 'UI_A',
      title: 'Lights',
      brief: 'Turn them on',
      overview: 'In this mission, the lights.',
      complete: 'Bright work!',
      flow: [
        objective('UI_A_1', 'Lights On'),
        {
          type: 'quiz',
          id: 'UI_A_Quiz',
          title: 'Checkpoint',
          questions: [{ id: 'UI_A_Q1', q: 'How many user LEDs?', answers: [{ a: 'Four' }, { a: 'Eight', correct: true }, { a: 'Two' }] }],
        },
        objective('UI_A_2', 'Unsafe', {
          instructions: 'Text <script>window.hacked = 1</script> <img src=x onerror="window.hacked = 1"> [bad](javascript:window.hacked=1)',
        }),
      ],
    },
  ],
}
const REST = {
  format: 1,
  id: 'UI',
  continues: 'UI_A',
  missions: [{ id: 'UI_B', title: 'Motors', brief: 'Drive', flow: [objective('UI_B_1', 'Drive On')] }],
}
const file = (name, data) => ({ name, mimeType: 'application/json', buffer: Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)) })

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

await page.goto(`${BASE}?device=loopback`, { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('opencodebot-learn')
    req.onsuccess = req.onerror = req.onblocked = r
  })
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

/** Open a pack file the way a student does: Learn, then Open a pack file. */
async function openPackFile(f) {
  await page.click('#btn-learn')
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#modal [data-pack-file]')])
  await chooser.setFiles(f)
}
const pane = (sel) => page.locator(`#learn-pane ${sel}`)
const text = (sel) => pane(sel).innerText()
const sideWidth = () => page.evaluate(() => document.getElementById('side-pane').getBoundingClientRect().width)

console.log('Opening a pack')
const sideBefore = await sideWidth()
check(await page.evaluate(() => document.getElementById('learn-pane').hidden), 'the pane starts closed')
await openPackFile(file('test-pack.json', PACK))
await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
check((await text('.learn-pack-title')) === 'Test pack', 'a pack file opens in the pane')
check((await text('.learn-body')).includes('Lights'), 'at the pack, its missions are listed')
const box = await page.locator('#learn-pane').boundingBox()
check(box.x + box.width <= 1440 + 1 && box.width >= 260, `the pane is at the right, ${Math.round(box.width)}px wide`)
check((await page.locator('.blocks-pane').boundingBox()).width >= 280, 'the editor keeps its room')

console.log('Steps')
await pane('[data-mission="0"]').click()
check((await text('.learn-body')).includes('In this mission, the lights.'), 'a mission starts with its introduction')
await pane('[data-learn="next"]').click()
check((await text('.learn-title')) === 'Lights On', 'Next goes to its first objective')
check((await text('.learn-count')).includes('1') && (await text('.learn-count')).includes('3'), 'it says which step of how many')
check(await pane('.lsec-concept').isVisible(), 'a Concept section is a panel')
check((await text('.learn-body')).includes('drag the block') && !(await text('.learn-body')).includes('type the line'), 'in blocks, the blocks text')
check((await pane('.learn-md img').getAttribute('src')) === PNG, 'the pack\'s image shows')
check((await text('.learn-goals')).includes('Light them all'), 'the goals are listed')

await page.evaluate(() => window.openCodeBot._toText())
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-body').innerText.includes('type the line'))
check(!(await text('.learn-body')).includes('drag the block'), 'switched to Python, the Python text')
await page.evaluate(() => window.openCodeBot._toBlocks())
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-body').innerText.includes('drag the block'))
check(true, 'and back to blocks, the blocks text')

console.log('A quiz')
await pane('[data-learn="next"]').click()
check((await text('.learn-title')) === 'Checkpoint', 'Next goes on to the quiz')
const wrong = pane('.learn-answer', { hasText: 'Four' })
await pane('.learn-answer').filter({ hasText: 'Four' }).click()
const four = pane('.learn-answer').filter({ hasText: 'Four' })
check((await four.getAttribute('data-verdict')) === 'wrong' && (await four.isDisabled()), 'a wrong answer is marked, and cannot be picked again')
await pane('.learn-answer').filter({ hasText: 'Eight' }).click()
check((await pane('.learn-answer').filter({ hasText: 'Eight' }).getAttribute('data-verdict')) === 'right', 'the right answer is marked')
void wrong

console.log('A pack holds no script')
await pane('[data-learn="next"]').click()
check((await text('.learn-title')) === 'Unsafe', 'the next objective')
await page.waitForTimeout(300)
check(!(await page.evaluate(() => window.hacked)), 'its HTML never ran')
check((await pane('.learn-body script, .learn-body img[onerror], .learn-body a[href^="javascript"]').count()) === 0, 'and is not in the page as HTML')
check((await text('.learn-body')).includes('<script>'), 'it shows as the text it is')

console.log('Back, the finish, and a reload')
await pane('[data-learn="next"]').click()
check((await text('.learn-body')).includes('Bright work!'), 'after the last step, the mission\'s finish')
await pane('[data-learn="back"]').click()
check((await text('.learn-title')) === 'Unsafe', 'Back goes back a step')
await page.waitForTimeout(200)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !document.getElementById('learn-pane').hidden && document.querySelector('#learn-pane .learn-title'))
check((await text('.learn-title')) === 'Unsafe', 'after a reload, the pack is open where the student was')

console.log('A broken pack, and a pack\'s second file')
await openPackFile(file('broken.json', { ...PACK, id: 'BROKEN', board: 'microbit' }))
await page.waitForSelector('.toast[data-kind="error"]')
check((await page.locator('.toast[data-kind="error"]').last().innerText()).includes('board'), 'a broken pack is refused, naming its problem')
check((await text('.learn-title')) === 'Unsafe', 'and the open pack stays')
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))
await openPackFile(file('test-pack-rest.json', REST))
await page.waitForSelector('.toast[data-kind="info"]')
check((await text('.learn-title')) === 'Unsafe', 'a pack\'s second file opens it where the student was')
await pane('[data-learn="up"]').click()
check((await pane('[data-mission]').count()) === 2 && (await text('.learn-body')).includes('Motors'), 'and its missions follow the first file\'s')

console.log('Kept, and closed')
await page.click('#btn-learn')
await page.waitForFunction(() => document.getElementById('modal')?.open)
check((await page.locator('#modal [data-pack="UI"]').count()) === 1, 'Learn lists the pack, kept in this browser')
await page.keyboard.press('Escape')
await pane('[data-learn="close"]').click()
check(await page.evaluate(() => document.getElementById('learn-pane').hidden), 'closing hides the pane')
check(Math.abs((await sideWidth()) - sideBefore) < 2, 'and the side is as wide as before')
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(300)
check(await page.evaluate(() => document.getElementById('learn-pane').hidden), 'and stays closed after a reload')
await page.click('#btn-learn')
await page.waitForFunction(() => document.getElementById('modal')?.open)
await page.click('#modal [data-pack="UI"]')
await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
check((await pane('[data-mission]').count()) === 2, 'opened again from Learn, it is where the student left it (its missions)')

await browser.close()
server?.kill()
if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
