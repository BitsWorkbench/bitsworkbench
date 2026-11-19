/**
 * A browser that cannot run the simulator (no WebAssembly at all, as with
 * Safari's Lockdown Mode; a browser without only JSPI runs the Asyncify build,
 * src/sim/support.js) is told so: Simulate says why and starts nothing, and
 * the boards page offers no board, keeping the boards saved here for a
 * browser that can. This takes WebAssembly away before the page loads.
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

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
// No WebAssembly: what Safari has in Lockdown Mode.
await context.addInitScript(() => {
  delete globalThis.WebAssembly
})
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
const workers = []
page.on('worker', (w) => workers.push(w.url()))

console.log('The app')
await page.goto(`${BASE}?device=loopback&lang=en`, { waitUntil: 'networkidle' })
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
  localStorage.setItem('opencodebot-boards', JSON.stringify([{ kind: 'codebot', code: 'print(1)' }]))
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check(await page.evaluate(() => typeof globalThis.WebAssembly === 'undefined'), 'the page has no WebAssembly')
await page.click('#btn-sim')
const toast = page.locator('.toast', { hasText: "This browser can't run the simulator" })
await toast.waitFor({ timeout: 5000 }).catch(() => {})
check(await toast.isVisible(), 'Simulate says this browser cannot run the simulator')
check((await toast.isVisible()) && (await toast.innerText()).includes('Chrome, Edge, Safari and Firefox'), 'and which browsers can')
await page.waitForTimeout(500)
check(!(await page.evaluate(() => window.openCodeBot.device.simulating)), 'and starts no simulator')
check(!workers.some((u) => u.includes('worker')), `no simulator worker was started (${workers.join(', ') || 'none'})`)

console.log('The boards page')
// No ?lang= here: the app's service worker, registered above, would serve the app for it.
await page.goto(`${BASE}boards.html`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => Array.isArray(window.boards))
check(await page.evaluate(() => window.boards.length === 0), 'it starts no board')
check(!(await page.locator('#bd-add').isVisible()), 'and offers none to add')
check((await page.locator('[data-i18n="boards.intro"]').innerText()).includes("can't run the simulator"), 'it says why')
check(await page.evaluate(() => localStorage.getItem('opencodebot-boards')?.includes('print(1)')), 'the boards saved here are kept')

await browser.close()
server?.kill()

if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('All good.')
