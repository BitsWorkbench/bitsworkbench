/**
 * Plays each prototype through CodeX mission 1 by mouse, touch and keyboard as a
 * student would, checks it ends where it should, and takes the study's screenshots.
 *   node walk.mjs            (all directions, all sizes)
 *   node walk.mjs C ipad     (one)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '../dist')
const SHOTS = join(HERE, '../shots')
mkdirSync(SHOTS, { recursive: true })
const exe = process.env.OCB_CHROMIUM || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const SIZES = { chromebook: [1366, 812, false], ipad: [1024, 812, true], phone: [390, 888, true] }
const [onlyDir, onlySize] = process.argv.slice(2)

const browser = await chromium.launch({ executablePath: exe })
const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

for (const dir of ['A', 'B', 'C', 'D']) {
  if (onlyDir && dir !== onlyDir) continue
  for (const [size, [w, h, touch]] of Object.entries(SIZES)) {
    if (onlySize && size !== onlySize) continue
    console.log(`${dir} ${size}`)
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => problems.push(`${dir} ${size}: ${e.message}`))
    await page.goto(`file://${DIST}/${dir}.html?size=${size}`)
    await page.waitForTimeout(400)
    const shot = (name) => page.screenshot({ path: join(SHOTS, `${dir}-${size}-${name}.png`) })
    const hot = (id) => page.locator(`[data-hot="${id}"]`)
    const press = async (loc) => { await loc.click(); await page.waitForTimeout(250) }
    const drag = async (from, to) => {
      const a = await from.boundingBox()
      const b = await to
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(a.x + a.width / 2 + 30, a.y + a.height / 2 + 10, { steps: 4 })
      await page.mouse.move(b[0], b[1], { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(250)
    }
    const orbit = async () => {
      const a = await hot('sim').boundingBox()
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(a.x + a.width / 2 + 60, a.y + a.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(250)
    }
    const edit = async () => {
      await press(hot('field'))
      await page.fill('.input-pop', "Hi, I'm Sam!")
      await page.keyboard.press('Enter')
      await page.waitForTimeout(250)
    }
    const blocksMiddle = async () => {
      const b = await hot('item').boundingBox()
      return [b.x + Math.min(b.width - 20, 200), b.y + 160]
    }

    if (dir === 'A') {
      await shot('1-open')
      await press(page.locator('.a-rail .tog'))
      await shot('2-closed-hud')
      await press(hot('view'))
      check(await page.locator('.banner').isVisible(), 'switching meets objective 1 and the banner says so')
      await shot('3-banner')
      await press(page.locator('[data-a="bnext"]'))
      check(await page.locator('.a-drawer[data-open="true"] h1').innerText() === 'Your Program', 'Next opens objective 2')
      await press(page.locator('.a-rail .tog'))
      await press(hot('view'))
      await edit()
      await press(page.locator('[data-a="bnext"]'))
      await press(page.locator('.a-rail .tog'))
      await press(hot('lights'))
      await drag(hot('item'), blocksMiddle())
      await press(page.locator('[data-a="bnext"]'))
      await press(hot('run'))
      check(await page.locator('.a-drawer[data-open="false"]').count() === 1, 'Run puts the drawer away')
      await shot('4-ran')
      check(await page.locator('.a-rail .st[data-done="true"]').count() === 4, 'all four objectives done')
    }
    if (dir === 'B') {
      await shot('1-card')
      await press(hot('view'))
      await shot('2-done')
      await press(page.locator('.card [data-a="next"]'))
      await press(hot('view'))
      await edit()
      await press(page.locator('.card [data-a="next"]'))
      await press(hot('lights'))
      await drag(hot('item'), blocksMiddle())
      await press(page.locator('.card [data-a="next"]'))
      await shot('3-objective4')
      await press(page.locator('.card [data-a="more"]'))
      await shot('4-read-more')
      await press(page.locator('.sheet [data-a="close"]'))
      await press(hot('run'))
      check(await page.locator('.card.done').count() === 1, 'running finishes objective 4')
    }
    if (dir === 'C' || dir === 'D') {
      await shot('0-intro')
      await press(page.locator('[data-a="go"]'))
      await shot('1-look')
      await orbit()
      await press(page.locator('[data-a="next"]'))
      await shot('2-run')
      await press(hot('run'))
      await page.waitForTimeout(500)
      await shot('2b-ran')
      await press(page.locator('[data-a="next"]'))
      await edit()
      await press(page.locator('[data-a="next"]'))
      await press(hot('run'))
      await page.waitForTimeout(500)
      await shot('4-ran-name')
      await press(page.locator('[data-a="next"]'))
      await press(hot('lights'))
      await press(page.locator('[data-a="next"]'))
      await page.waitForTimeout(1300)
      await shot('6-add')
      // the keyboard way to add a block
      await hot('item').focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(250)
      await press(page.locator('[data-a="next"]'))
      await press(hot('run'))
      await page.waitForTimeout(700)
      await shot('7-lights')
      await press(page.locator('[data-a="next"]'))
      await press(hot('view'))
      await page.waitForTimeout(1600)
      await shot('8-python')
      await press(page.locator('[data-a="next"]'))
      await press(page.locator('[data-ans="0"]'))
      await press(page.locator('[data-ans="1"]'))
      await shot('9-ask')
      await press(page.locator('[data-a="next"]'))
      await page.waitForTimeout(900)
      await shot('10-done')
      check((await page.locator('.centre-card pre').innerText()).includes("Hi, I'm Sam!"), 'the finish shows the student\'s own program')
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll')
    }
    await ctx.close()
  }
}

// D in Spanish with reduced motion, by keyboard only: the foundations, shown.
if (!onlyDir || onlyDir === 'D') {
  console.log('D chromebook, Spanish, reduced motion, keyboard')
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 812 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => problems.push(`D es: ${e.message}`))
  await page.goto(`file://${DIST}/D.html?size=chromebook&lang=es`)
  await page.waitForTimeout(300)
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); await page.waitForTimeout(150) }
  const focusHot = (id) => page.locator(`[data-hot="${id}"]`).focus()
  await page.locator('[data-a="go"]').focus()
  await key('Enter')
  await page.locator('[data-a="skip"]').focus()
  await key('Enter')
  await focusHot('run')
  await key('Enter')
  check(await page.evaluate(() => document.activeElement?.dataset?.a === 'next'), 'after a goal is met, focus is on Next')
  await key('Enter')
  await focusHot('field')
  await key('Enter')
  await page.keyboard.type("Hola, soy Ana")
  await key('Enter')
  await page.locator('[data-a="next"]').focus()
  await key('Enter')
  await focusHot('run')
  await key('Enter')
  await page.locator('[data-a="next"]').focus()
  await key('Enter')
  await focusHot('lights')
  await key('Enter')
  await page.locator('[data-a="next"]').focus()
  await key('Enter')
  await page.screenshot({ path: join(SHOTS, 'D-es-reduced-6-add.png') })
  check(await page.evaluate(() => !document.querySelector('.hand') || getComputedStyle(document.querySelector('.hand')).display === 'none'), 'reduced motion: no flying hand')
  check((await page.locator('#live').innerText()).includes('Arrastra'), 'the step is announced, in Spanish')
  await ctx.close()
}
await browser.close()
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log('\nAll good.')
