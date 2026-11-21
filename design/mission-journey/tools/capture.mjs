/**
 * Captures the real OpenCodeBot UI, in the states the mission-journey prototypes
 * need, as backdrops, and the boxes of the controls the prototypes point at.
 * Run against a dev server (npx vite --port 5287): node capture.mjs [base url]
 * Writes ../proto/backdrops/<size>-<state>.jpg and ../proto/anchors.json.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '../proto/backdrops')
mkdirSync(OUT, { recursive: true })
const BASE = process.argv[2] || 'http://localhost:5287/'
const exe = process.env.OCB_CHROMIUM || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`

const SIZES = [
  ['chromebook', 1366, 768, false],
  ['ipad', 1024, 768, true],
  ['phone', 390, 844, true],
]
const START = 'from codex import *\n\ndisplay.show("Hi there!")\n'
const WITH_LIGHTS = 'from codex import *\n\ndisplay.show("Hi there!")\npixels.fill(RED)\n'
const NAMED = START.replace('Hi there!', "Hi, I'm Sam!")
const NAMED_LIGHTS = WITH_LIGHTS.replace('Hi there!', "Hi, I'm Sam!")
const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]

const browser = await chromium.launch({ executablePath: exe })
const anchors = {}
for (const [size, width, height, touch] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    for (const db of (await indexedDB.databases?.()) || []) indexedDB.deleteDatabase(db.name)
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codex')
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
  if (!/stop/i.test(await page.innerText('#btn-sim'))) await page.click('#btn-sim')
  await page.waitForTimeout(5000)

  const setCode = (py) =>
    page.evaluate((py) => {
      const app = window.openCodeBot
      const r = app.blocksFromPython(py)
      if (!r.ok) throw new Error(`does not parse at ${r.line}`)
      app.workspace.replaceBlocks(r.state)
    }, py)
  const clean = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))
  const shot = async (state) => {
    await clean()
    await page.screenshot({ path: join(OUT, `${size}-${state}.jpg`), type: 'jpeg', quality: 78 })
  }
  const box = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    }, sel)
  const byText = (text) =>
    page.evaluate((text) => {
      const els = [...document.querySelectorAll('.blocklyToolboxCategory, .blocklyTreeRow, [role="treeitem"]')]
      const el = els.find((e) => e.textContent.trim().includes(text))
      if (!el) return null
      const r = (el.querySelector('.blocklyTreeRow') || el).getBoundingClientRect()
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
    }, text)
  // The program's stack, its text field and its last block.
  const blk = () =>
    page.evaluate(() => {
      const B = window.openCodeBotInternals.Blockly
      const R = (r) => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
      const top = B.getMainWorkspace().getTopBlocks(true)[0]
      const out = { stack: R(top.getSvgRoot().getBoundingClientRect()) }
      const all = top.getDescendants(true)
      const text = all.flatMap((b) => b.inputList.flatMap((i) => i.fieldRow)).find((f) => f instanceof B.FieldTextInput)
      if (text) out.textField = R(text.getSvgRoot().getBoundingClientRect())
      const last = all.filter((b) => b.previousConnection && !b.outputConnection).pop()
      if (last) out.lastBlock = R(last.getSvgRoot().getBoundingClientRect())
      return out
    })
  const runAndWait = async () => {
    await page.click('#btn-run')
    await page.waitForTimeout(3200)
  }
  const flip = async () => {
    await page.click('#btn-view')
    await page.waitForTimeout(900)
  }

  // Every state the prototypes show, as the real app draws it. `p` prefixes the
  // file names: '' with no mission open, 'a-' with today's rail (drawer put away).
  const states = async (p) => {
    const a = {
      run: await box('#btn-run'),
      view: await box('#btn-view'),
      side: await box('#side-pane'),
      blocks: await box('#blocks-pane'),
      canvas: await box('#side-pane canvas'),
      lights: await byText('Lights'),
    }
    await setCode(START)
    await page.waitForTimeout(600)
    await shot(p + 'start')
    a.start = await blk()
    await flip()
    await shot(p + 'pythonstart')
    await flip()
    await runAndWait()
    await shot(p + 'startran')
    await setCode(NAMED)
    await page.waitForTimeout(600)
    await shot(p + 'named')
    await runAndWait()
    await shot(p + 'namedran')
    await page.mouse.click(a.lights[0] + a.lights[2] / 2, a.lights[1] + a.lights[3] / 2)
    await page.waitForTimeout(700)
    a.flyout = await page.evaluate(() => {
      const ws = window.openCodeBotInternals.Blockly.getMainWorkspace().getFlyout().getWorkspace()
      return ws.getTopBlocks(true).map((b) => {
        const r = b.getSvgRoot().getBoundingClientRect()
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]
      })
    })
    await shot(p + 'lights')
    await page.keyboard.press('Escape')
    await page.mouse.click(a.blocks[0] + a.blocks[2] - 60, a.blocks[1] + a.blocks[3] - 120)
    await setCode(NAMED_LIGHTS)
    await page.waitForTimeout(700)
    await shot(p + 'added')
    a.added = await blk()
    await runAndWait()
    await shot(p + 'ran')
    await flip()
    await shot(p + 'python')
    await flip()
    return a
  }

  const a = await states('')
  a.learn = await box('#btn-learn')

  // Today's drawer: the CodeX sampler, mission 1, at "The Simulator".
  await page.click('#btn-learn')
  await page.click('#modal [data-builtin="LCX"]')
  await page.waitForFunction(() => !document.getElementById('learn-pane').hidden)
  await clean()
  await page.locator('#learn-pane [data-mission="0"]').click()
  for (let i = 0; i < 4; i++) await page.locator('#learn-pane [data-learn="next"]').click()
  await page.waitForTimeout(500)
  await shot('a-open')
  a.rail = await box('#learn-rail')
  a.pane = await box('#learn-pane')
  await page.click('#learn-rail .rail-toggle')
  await page.waitForTimeout(600)
  a.A = await states('a-')

  anchors[size] = { width, height, ...a }
  console.log(size, 'ok')
  await ctx.close()
}
writeFileSync(join(HERE, '../proto/anchors.json'), JSON.stringify(anchors, null, 1))
await browser.close()
