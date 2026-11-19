/**
 * The first visit is light: the Python editor (CodeMirror) and the mission
 * text's Markdown come in only when first needed (src/editor/lazy-editor.js,
 * src/learn/tutorial.js). Here: neither loads with the page, which stays in
 * its download budget; and nothing a student types or has saved is lost
 * while the editor loads late, or if it cannot load at all. Run after
 * `npm run build`.
 */
import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const URL_ = `${BASE}?device=loopback&board=codebot`
const DIST = new URL('../dist/', import.meta.url).pathname
const FIRST_KB = 600 // the first visit's budget, gzip (tests/perf.mjs)
const EDITOR = /\/assets\/python-editor-[^/]*\.js$/
const MARKDOWN = /\/assets\/markdown-[^/]*\.js$/

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

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})

/**
 * A fresh page (no service worker, so every request is the network's and
 * routes see it), welcomed, on CodeBot, with `project` saved if given.
 * `editor`: 'slow' holds the editor's part back until `release()`, 'gone'
 * fails it.
 */
async function open({ project = null, editor = 'normal' } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await context.addInitScript((p) => {
    if (sessionStorage.getItem('lazy-parts.set')) return
    sessionStorage.setItem('lazy-parts.set', '1')
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
    if (p) localStorage.setItem('opencodebot.project.v1', JSON.stringify(p))
  }, project)
  let release = () => {}
  const held = new Promise((r) => { release = r })
  if (editor === 'slow') await context.route(EDITOR, async (route) => { await held; await route.continue() })
  if (editor === 'gone') await context.route(EDITOR, (route) => route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const urls = []
  page.on('request', (r) => urls.push(r.url()))
  // A held part keeps the network busy: then only to the page's load.
  await page.goto(URL_, { waitUntil: editor === 'slow' ? 'load' : 'networkidle' })
  await page.waitForFunction(() => !!window.openCodeBot)
  return { context, page, urls, errors, release }
}

const ed = (page, expr) => page.evaluate(`(() => { const e = window.openCodeBot.pythonEditor; return ${expr} })()`)
const pythonText = (page) => page.evaluate(() => window.openCodeBot.workspace.pythonText)
const editorIn = (page) => page.waitForSelector('#python-editor .cm-editor', { timeout: 15000 })

// 1. The first visit: no editor, no Markdown, within budget.
{
  const { context, page, urls } = await open()
  check(!urls.some((u) => EDITOR.test(u)), 'the first visit does not load the Python editor')
  check(!urls.some((u) => MARKDOWN.test(u)), 'the first visit does not load the Markdown renderer')
  check((await page.locator('.cm-editor').count()) === 0, 'and no editor is made while the blocks show')
  const gz = (u) => {
    const p = path.join(DIST, new URL(u).pathname.replace(/^\//, ''))
    return u.startsWith(BASE) && fs.existsSync(p) && fs.statSync(p).isFile() ? gzipSync(fs.readFileSync(p)).length : 0
  }
  const kb = Math.round([...new Set(urls)].reduce((a, u) => a + gz(u), 0) / 1024)
  check(kb <= FIRST_KB, `the first visit is ${kb} KB gzip, within its ${FIRST_KB} KB budget`)
  // The editor comes when Python is first shown.
  await page.click('#btn-view')
  await editorIn(page)
  check(urls.some((u) => EDITOR.test(u)), 'switching to Python loads the editor')
  await context.close()
}

// 2. Typing while the editor is still on its way lands, and carries on in the editor.
{
  const { context, page, errors, release } = await open({ editor: 'slow' })
  await page.click('#btn-view')
  await page.keyboard.type('x = 1')
  check(await page.isVisible('#python-editor .python-editor-box'), 'while the editor loads, a text box holds the program')
  check(await page.evaluate(() => document.activeElement?.classList.contains('python-editor-box')), 'and has the focus, so typing goes in')
  check((await pythonText(page)).endsWith('x = 1'), 'what is typed meanwhile is the program at once')
  release()
  await editorIn(page)
  check((await page.locator('#python-editor .python-editor-box').count()) === 0, 'once the editor is in, the box is gone')
  check(await page.evaluate(() => !!document.activeElement?.closest('.cm-editor')), 'and the editor has the focus')
  await page.keyboard.type(' + 2')
  check((await ed(page, 'e.value')).endsWith('x = 1 + 2'), 'typing carries on where it was, nothing lost')
  check((await pythonText(page)) === (await ed(page, 'e.value')), 'and the program is what the editor holds')
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await context.close()
}

// 3. A snippet used while the editor loads goes in once it is.
{
  const { context, page, release } = await open({ editor: 'slow' })
  await page.click('#btn-view')
  await page.click('.py-cat')
  const card = page.locator('.snippet').first()
  const code = (await card.textContent()).trim()
  await card.click()
  release()
  await editorIn(page)
  await page.waitForFunction((c) => window.openCodeBot.pythonEditor.value.includes(c.split('\n')[0]), code, { timeout: 5000 }).catch(() => {})
  check((await ed(page, 'e.value')).includes(code.split('\n')[0]), 'a snippet clicked while the editor loads goes in once it is')
  await context.close()
}

// 4. A saved Python program opens, while the editor loads and after.
{
  const saved = { format: 'opencodebot', version: 1, name: 'kept', device: 'codebot', blocks: {}, mode: 'text', python: 'from botcore import *\nprint("kept")\n' }
  const { context, page, release } = await open({ project: saved, editor: 'slow' })
  check((await page.inputValue('#python-editor .python-editor-box').catch(() => '')) === saved.python, 'a saved Python program shows at once, before the editor is in')
  release()
  await editorIn(page)
  check((await ed(page, 'e.value')) === saved.python, 'and the editor opens with it, unchanged')
  check((await page.evaluate(() => window.openCodeBot.workspace.mode)) === 'text', 'still as Python')
  await context.close()
}

// 5. The editor cannot load (gone from the server, or offline): the box is the editor, and keeps the work.
{
  const { context, page, errors } = await open({ editor: 'gone' })
  // A missing part reloads the page once onto a new build (src/ui/new-build.js); here the part is
  // missing on every load, so the page reloads once and then carries on with the box.
  const reloaded = page.waitForEvent('load', { timeout: 10000 }).then(() => true, () => false)
  await page.click('#btn-view')
  await reloaded
  await page.waitForFunction(() => !!window.openCodeBot)
  await page.waitForSelector('#python-editor .python-editor-box', { timeout: 10000 })
  await page.waitForTimeout(500)
  check((await page.locator('#python-editor .python-editor-box').count()) === 1, 'with no editor to load, the text box stays and is the editor')
  await page.click('#python-editor .python-editor-box')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('y = 2')
  check((await pythonText(page)).endsWith('y = 2'), 'typing in it is the program')
  await page.waitForTimeout(1500) // the app saves a moment after a change
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForSelector('#python-editor .python-editor-box', { timeout: 10000 })
  check((await page.inputValue('#python-editor .python-editor-box')).endsWith('y = 2'), 'and it is kept across a reload')
  check(!errors.some((e) => !/dynamically imported module|Importing a module script failed/i.test(e)), `no other page errors${errors.length ? `: ${errors.join('; ')}` : ''}`)
  await context.close()
}

await browser.close()
server?.kill()
if (problems.length) {
  console.log(`\nlazy-parts: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log('\nlazy-parts: all good')
