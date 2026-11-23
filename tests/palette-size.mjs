/**
 * The palettes' size switch, at the screens students use (a Chromebook, a
 * laptop, iPads across and upright): small, both the block palette and the
 * Python palette show only each category's colour and emoji, with its name
 * kept for screen readers and as a tooltip; the program gets the room back;
 * a small category still opens; it switches by mouse, touch and keyboard;
 * and it is remembered after a reload.
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
    localStorage.setItem('opencodebot.welcome.v1', 'off')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)

  const press = (sel) => (touch ? page.tap(sel) : page.click(sel))
  const toolbox = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getToolbox().getWidth())
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  // Whether each label's words after its emoji start past the label's clip.
  const onlyEmoji = (sel) =>
    page.$$eval(sel, (els) =>
      els.filter((el) => el.offsetParent).every((el) => {
        const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.data.includes(' '))
        if (!text) return false
        const range = document.createRange()
        range.setStart(text, text.data.indexOf(' ') + 1)
        range.setEnd(text, text.data.length)
        return range.getBoundingClientRect().left >= el.getBoundingClientRect().right - 1
      }),
    )

  const full = await toolbox()
  check((await page.getAttribute('#btn-palette-size', 'aria-label'))?.length > 0, 'the switch has a name')
  await press('#btn-palette-size')
  await page.waitForTimeout(200)
  const small = await toolbox()
  check(small <= 64 && small < full - 60, `${touch ? 'a tap' : 'a click'} makes the block palette small (${Math.round(full)}px to ${Math.round(small)}px)`)
  check(await noScroll(), 'no sideways scrolling')
  const cats = await page.$$eval('.blocklyToolboxCategory', (els) => els.filter((e) => e.offsetParent).map((e) => ({ title: e.title, text: e.textContent.trim() })))
  check(cats.length > 5 && cats.every((c) => c.title === c.text && /\p{L}/u.test(c.text)), 'each category keeps its whole name, and shows it as a tooltip')
  check(await onlyEmoji('.blocklyToolboxCategoryLabel'), 'only the emoji shows in each category')
  await press('.blocklyToolboxCategory >> nth=1')
  await page.waitForTimeout(300)
  const fly = await page.evaluate(() => {
    const ws = window.openCodeBot.workspace.workspace
    const f = ws.getToolbox().getFlyout()
    return { open: f.isVisible(), left: f.svgGroup_?.getBoundingClientRect().left ?? document.querySelector('.blocklyFlyout').getBoundingClientRect().left }
  })
  check(fly.open && fly.left <= small + 4, 'a small category opens its blocks beside the palette')

  await page.evaluate(() => window.openCodeBot._toText())
  await page.waitForTimeout(200)
  const py = await page.evaluate(() => document.getElementById('py-palette').getBoundingClientRect().width)
  check(py <= 64, `the Python palette is small too (${Math.round(py)}px)`)
  const pyCats = await page.$$eval('.py-cat', (els) => els.map((e) => e.title === e.textContent.trim() && e.textContent.trim().length > 2))
  check(pyCats.length > 5 && pyCats.every(Boolean), 'its categories keep their names, and show them as tooltips')
  check(await onlyEmoji('.py-cat'), 'and show only their emoji')
  await press('.py-cat >> nth=1')
  check(await page.evaluate(() => !document.getElementById('py-flyout').hidden), 'a small Python category opens')
  check(await noScroll(), 'still no sideways scrolling')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
  check((await page.evaluate(() => document.querySelector('.editor-main').dataset.palette)) === 'small', 'after a reload, still small')

  await press('#btn-palette-size')
  await page.waitForTimeout(200)
  check(
    (await page.evaluate(() => document.querySelector('.editor-main').dataset.palette)) === 'full' &&
      (await page.$$eval('.blocklyToolboxCategory, .py-cat', (els) => els.every((e) => !e.title))),
    'and back to full, no tooltips',
  )

  if (name.startsWith('Chromebook')) {
    console.log('Keyboard')
    await page.focus('#btn-palette-size')
    await page.keyboard.press('Enter')
    check((await page.evaluate(() => document.querySelector('.editor-main').dataset.palette)) === 'small', 'Enter on the switch makes it small')
    await page.keyboard.press('Space')
    check((await page.evaluate(() => document.querySelector('.editor-main').dataset.palette)) === 'full', 'and Space makes it full again')
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
