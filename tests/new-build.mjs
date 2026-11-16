/**
 * After a deploy, a page still on the old build reloads onto the new one
 * (src/ui/new-build.js): here, a part that fails to load reloads the page
 * once, the student's work is still there after it, and a second failure
 * within the minute does not reload again. A stale page with its stylesheet,
 * view and worker gone needs two builds to show, and is not tested here. Run
 * with `npm run build` first.
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

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

await page.goto(`${BASE}?board=codebot`, { waitUntil: 'networkidle' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
await page.keyboard.press('Escape')

// The student's work, changed just now (the app saves it a moment later).
const blocks = () => page.evaluate(() => window.openCodeBot.workspace.workspace.getAllBlocks(false).length)
await page.evaluate(() => {
  window.openCodeBot.workspace.workspace.newBlock('ocb_seconds_since_start').initSvg()
  window.__sameLoad = true
})
const before = await blocks()

// What the browser says when a part of the page is no longer on the server.
const missingPart = () =>
  page.evaluate(() => {
    Promise.reject(new TypeError('Failed to fetch dynamically imported module: https://example.invalid/assets/view-old.js'))
  })

const reloaded = page.waitForEvent('load', { timeout: 10000 }).then(() => true, () => false)
await missingPart()
check(await reloaded, 'a part that fails to load reloads the page')
await page.waitForFunction(() => !!window.openCodeBot)
const after = await blocks()
check(after === before, `the work is still there after the reload (${after} blocks of ${before})`)

await page.evaluate(() => {
  window.__sameLoad = true
})
await missingPart()
await page.waitForTimeout(1500)
check(await page.evaluate(() => window.__sameLoad === true), 'a second failure within the minute does not reload again')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
