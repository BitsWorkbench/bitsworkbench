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
  missions: [
    {
      id: 'UI_B',
      title: 'Motors',
      brief: 'Drive',
      flow: [
        objective('UI_B_1', 'Drive On', { solution: 'from botcore import *\n\nleds.user(0b11111111)\n' }),
        // Mostly Python with no block: taught in Python.
        objective('UI_B_2', 'Careful Driving', { solution: 'from botcore import *\n\ntry:\n    leds.user(255)\nexcept OSError as err:\n    print(err)\n' }),
      ],
    },
  ],
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

console.log('Taught in blocks, or in Python')
await pane('[data-mission="1"]').click()
await pane('[data-learn="next"]').click()
check((await text('.learn-title')) === 'Drive On' && (await pane('.learn-python').count()) === 0, 'code that is all blocks: no word about Python')
await pane('[data-learn="next"]').click()
check((await text('.learn-title')) === 'Careful Driving' && (await pane('.learn-python').count()) === 1, 'code that is mostly Python blocks: in blocks, the step says it is taught in Python')
await pane('[data-learn="python"]').click()
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-body').innerText.includes('type the line'))
check((await page.evaluate(() => window.openCodeBot.workspace.mode)) === 'text', 'its button switches to Python')
check((await pane('.learn-python').count()) === 0, 'and in Python the word is gone')
await page.evaluate(() => window.openCodeBot._toBlocks())
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-python'))
check(true, 'back in blocks, it is there again')
await pane('[data-learn="up"]').click()

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

console.log('Goals')
const GOALS = {
  format: 1,
  id: 'GOALS',
  title: 'Goals pack',
  brief: 'Goals',
  board: 'codebot',
  missions: [
    {
      id: 'GOALS_M',
      title: 'Goals',
      flow: [
        {
          type: 'objective',
          id: 'GOALS_1',
          title: 'Reach the goals',
          instructions: 'Do it.',
          goals: [
            { md: 'Light every other one', check: { has: 'leds.user(0b10101010)' } },
            { md: 'Run it', check: { runs: true } },
            { md: 'It says it runs', check: { prints: 'running main\\.py' } },
            { md: 'Switch to blocks', check: { event: 'switched' } },
          ],
          complete: 'All lit up!',
        },
      ],
    },
  ],
}
const ticked = () => page.$$eval('#learn-pane .learn-goals li', (lis) => lis.map((li) => li.dataset.met === 'true'))
await page.evaluate(() => window.openCodeBot._toText())
await openPackFile(file('goals.json', GOALS))
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-body')?.innerText.includes('Goals'))
await pane('[data-mission="0"]').click()
await pane('[data-learn="next"]').click()
await page.waitForTimeout(400)
check((await ticked()).join() === 'false,false,false,false', `an objective opens with its goals to do (${(await ticked()).join()})`)

await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('\nleds.user(0b10101010)\n')
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-goals li')?.dataset.met === 'true', null, { timeout: 5000 })
check((await ticked()).join() === 'true,false,false,false', 'typing the line meets the code goal, and only it')

await page.click('#btn-connect')
await page.waitForFunction(() => !document.getElementById('btn-run').disabled)
await page.click('#btn-run')
await page.waitForFunction(() => !document.getElementById('btn-stop').hidden)
await page.click('#btn-stop')
await page.waitForFunction(() => document.querySelectorAll('#learn-pane .learn-goals li[data-met="true"]').length === 3, null, { timeout: 5000 })
check((await ticked()).join() === 'true,true,true,false', 'a run meets the run goal, and its output the prints goal')

await page.click('#btn-view')
await page.waitForFunction(() => document.querySelectorAll('#learn-pane .learn-goals li[data-met="true"]').length === 4, null, { timeout: 5000 })
check((await pane('.learn-complete').innerText()).includes('All lit up!'), 'switching meets the last goal, and the objective cheers')

await page.waitForTimeout(300)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelectorAll('#learn-pane .learn-goals li[data-met="true"]').length === 4, null, { timeout: 5000 })
check(true, 'met goals stay met after a reload')
await pane('[data-learn="up"]').click()
check((await pane('[data-mission="0"]').getAttribute('data-done')) === 'true', 'and the mission shows as finished')

console.log('CodeTrek in the palette')
const TREK = {
  format: 1,
  id: 'TREK',
  title: 'Trek pack',
  brief: 'CodeTrek',
  board: 'codebot',
  missions: [
    {
      id: 'TREK_M',
      title: 'Trek',
      flow: [
        {
          type: 'objective',
          id: 'TREK_1',
          title: 'Blocks trek',
          instructions: 'Drag the chunks in.',
          trek: [
            // The import in one chunk makes the next one's sleep(1) the wait block.
            { md: 'Turn **every** light on', python: 'from time import sleep\nleds.user(0b11111111)\n' },
            { md: 'Wait, then the next step is yours', python: 'sleep(1)\npass  # TODO: turn them off\n' },
          ],
          goals: [{ md: 'Use the CodeTrek', check: { event: 'trek-used' } }],
        },
        {
          type: 'objective',
          id: 'TREK_2',
          title: 'Python trek',
          instructions: 'Drag the chunk in.',
          trek: [{ md: 'Wait a moment', python: 'from time import sleep\nsleep(0.25)\n' }],
          goals: [{ md: 'Use the CodeTrek', check: { event: 'trek-used' } }],
        },
        { type: 'objective', id: 'TREK_3', title: 'No trek', instructions: 'Nothing provided.', goals: [{ md: 'Run', check: { runs: true } }] },
      ],
    },
  ],
}
const trekShown = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getToolbox().getToolboxItemById('codetrek').isVisible())
await page.evaluate(() => window.openCodeBot._toBlocks())
check(!(await trekShown()), 'with no objective open, the block palette has no CodeTrek')
await openPackFile(file('trek.json', TREK))
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-body')?.innerText.includes('Trek'))
await pane('[data-mission="0"]').click()
await pane('[data-learn="next"]').click()
await page.waitForFunction(() => window.openCodeBot.workspace.workspace.getToolbox().getToolboxItemById('codetrek').isVisible())
check(true, 'an objective with a CodeTrek shows it in the block palette')
const flyout = await page.evaluate(() => {
  const ws = window.openCodeBot.workspace.workspace
  const toolbox = ws.getToolbox()
  toolbox.setSelectedItem(toolbox.getToolboxItemById('codetrek'))
  const fly = toolbox.getFlyout().getWorkspace()
  const types = (b) => [b.type, ...b.getChildren(true).flatMap(types)]
  return {
    blocks: fly.getTopBlocks(true).map((b) => types(b).join('>')),
    labels: [...document.querySelectorAll('.blocklyFlyout .blocklyFlyoutLabelText')].map((l) => l.textContent),
  }
})
check(flyout.labels.join('|') === '1. Turn every light on|2. Wait, then the next step is yours', `its chunks, under their captions (${flyout.labels.join('|')})`)
check(flyout.blocks.length === 2 && flyout.blocks[0] === 'codebot_leds_pattern' && flyout.blocks[1].includes('ocb_todo'), `as blocks, the to-do a "to do" block (${flyout.blocks.join(' ; ')})`)
check(flyout.blocks[1]?.startsWith('ocb_wait'), `a chunk's sleep(1) is the wait block, by another chunk's from time import sleep (${flyout.blocks[1]})`)

// Drag the second chunk out of the flyout onto the canvas.
const from = await page.evaluate(() => {
  const fly = window.openCodeBot.workspace.workspace.getToolbox().getFlyout().getWorkspace()
  const r = fly.getTopBlocks(true)[1].getSvgRoot().getBoundingClientRect()
  return { x: r.left + 10, y: r.top + 10 }
})
const canvas = await page.locator('#blockly-root').boundingBox()
await page.mouse.move(from.x, from.y)
await page.mouse.down()
await page.mouse.move(from.x + 40, from.y + 10, { steps: 5 })
await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6, { steps: 10 })
await page.mouse.up()
await page.waitForFunction(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).some((b) => b.type === 'ocb_todo'))
check(true, 'a chunk drags onto the canvas, its to-do with it')
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-goals li')?.dataset.met === 'true', null, { timeout: 5000 })
check(true, 'and dragging it in meets the trek-used goal')
check(
  await page.evaluate(() => !window.openCodeBot.workspace.workspace.getAllBlocks(false).some((b) => b.data?.includes('"trek"'))),
  'the dropped blocks are the student\'s own (no CodeTrek mark left on them)',
)
// The "to do" block is `pass  # TODO: ...` in Python, and the same block again back from it.
await page.evaluate(() => window.openCodeBot._toText())
check((await page.evaluate(() => window.openCodeBot.pythonEditor.value)).includes('pass  # TODO: turn them off'), 'in Python, the to-do is pass  # TODO: turn them off')
await page.evaluate(() => {
  const app = window.openCodeBot
  app.pythonEditor.value = app.pythonEditor.value.replace('# TODO: turn them off', '# TODO: turn them all off')
})
await page.evaluate(() => window.openCodeBot._toBlocks())
check(
  await page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).some((b) => b.type === 'ocb_todo' && b.getFieldValue('TEXT') === 'turn them all off')),
  'and back in blocks it is the "to do" block, with the words changed in Python',
)

await pane('[data-learn="next"]').click()
await page.evaluate(() => window.openCodeBot._toText())
await page.waitForSelector('#py-palette .py-cat >> text=CodeTrek')
await page.click('#py-palette .py-cat >> text=CodeTrek')
check((await page.locator('#py-flyout .snippet-name').innerText()) === '1. Wait a moment', 'in Python, the CodeTrek is a palette category of the chunks')
await page.click('#py-flyout .snippet')
const typed = await page.evaluate(() => window.openCodeBot.pythonEditor.value)
check(typed.includes('sleep(0.25)') && /^(from time import sleep|import time)/m.test(typed), 'clicking a chunk puts it in, its import at the top')
await page.waitForFunction(() => document.querySelector('#learn-pane .learn-goals li')?.dataset.met === 'true', null, { timeout: 5000 })
check(true, 'and meets the trek-used goal')

await pane('[data-learn="next"]').click()
await page.waitForTimeout(200)
check((await page.locator('#py-palette .py-cat', { hasText: 'CodeTrek' }).count()) === 0, 'an objective with no CodeTrek has no CodeTrek category')
await page.evaluate(() => window.openCodeBot._toBlocks())
check(!(await trekShown()), 'in either palette')
await pane('[data-learn="close"]').click()

console.log('A slow regular expression cannot hang the page')
const slow = await page.evaluate(async () => {
  const tester = window.openCodeBot.learn.watcher.tester
  let ticks = 0
  const timer = setInterval(() => ticks++, 10)
  const started = performance.now()
  // Allowed by the pack reader (no repeat inside a repeat), but polynomial: hours on 1000 characters.
  const slowMatch = await tester.test('.*.*.*.*.*.*x', 'a'.repeat(1000))
  const took = performance.now() - started
  clearInterval(timer)
  const after = await tester.test('^ok', 'ok then')
  const again = await tester.test('.*.*.*.*.*.*x', 'a')
  return { slowMatch, took, ticks, after, again }
})
check(slow.slowMatch === false && slow.took < 1000, `it is stopped in ${Math.round(slow.took)} ms and counts as not matching`)
check(slow.ticks >= 3, `the page kept running meanwhile (${slow.ticks} timer ticks)`)
check(slow.after === true, 'the next regex is tested as usual')
check(slow.again === false, 'and the slow one is never tried again')

console.log('A pack that comes with Codacious')
{
  const index = await page.evaluate(() => fetch(new URL('learn/packs/index.json', document.baseURI)).then((r) => r.json()))
  const first = index[0]
  await page.click('#btn-learn')
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  check((await page.locator('#modal [data-builtin]').count()) === index.length, `Learn lists the packs that come with Codacious (${index.map((p) => p.id).join(', ')})`)
  check(await page.locator(`#modal [data-builtin="${first.id}"]`).innerText().then((s) => s.includes(first.title)), 'each card names its pack')
  await page.click(`#modal [data-builtin="${first.id}"]`)
  await page.waitForFunction((title) => !document.getElementById('learn-pane').hidden && document.querySelector('#learn-pane .learn-pack-title')?.textContent === title, first.title, { timeout: 30000 })
  check((await pane('[data-mission]').count()) > 0, `it opens in the pane, with its missions (${await pane('[data-mission]').count()})`)
  await page.click('#btn-learn')
  await page.waitForFunction(() => document.getElementById('modal')?.open)
  check((await page.locator(`#modal [data-pack="${first.id}"]`).count()) === 0, 'once kept, it is still one card, not two')
  await page.keyboard.press('Escape')
}

await browser.close()
server?.kill()
if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
