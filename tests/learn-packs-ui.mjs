/**
 * The packs that come with the app, in the app: each opened from Learn, its
 * first missions stepped through with Next on the simulator, and every goal
 * ticking as a student meets it. A program goal gets the program the pack
 * builds toward (as tests/free-missions.mjs finds it) and Run; a part goal a
 * click on that part; an app goal (switched, edited, ...) the event itself.
 * A code goal the pack alone cannot meet (the student writes that part) is
 * left out.
 *
 *   node tests/learn-packs-ui.mjs                                 Chromium
 *   OCB_ENGINES=webkit node tests/learn-packs-ui.mjs              Safari's engine
 *   OCB_ENGINES=webkit OCB_DEVICE='iPad (gen 7) landscape' node tests/learn-packs-ui.mjs
 *   OCB_MISSIONS=3 node tests/learn-packs-ui.mjs                  more missions
 *
 * Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import * as playwright from 'playwright'
import { met } from '../src/learn/checks.js'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const ENGINES = (process.env.OCB_ENGINES || 'chromium').split(',')
const DEVICE = process.env.OCB_DEVICE ? playwright.devices[process.env.OCB_DEVICE] : null
const MISSIONS = Number(process.env.OCB_MISSIONS || 2)

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok
  } catch {
    return false
  }
}
let server = null
if (!(await reachable(BASE))) {
  server = spawn('npx', ['vite', 'preview', '--port', new URL(BASE).port || '4173', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await reachable(BASE)); i++) await new Promise((r) => setTimeout(r, 250))
}

const problems = []
const check = (ok, label) => {
  console.log(`  ${ok ? 'ok' : 'FAIL'}  ${label}`)
  if (!ok) problems.push(label)
}

const dir = new URL('../public/learn/packs/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'))
const MODELS = { codebot: 'codebot-body', codex: 'codex', codeair: 'codeair' }
const leaves = (c) => (c.all || c.any ? (c.all || c.any).flatMap(leaves) : [c])
const isCode = (c) => 'has' in c || 'order' in c
const seenOf = (program) => ({ program, runs: [], events: [], printed: new Set(), picked: new Set() })

/** The names of a board's parts a click can land on (tests/free-missions.mjs). */
function partsOf(board) {
  const names = JSON.parse(readFileSync(new URL(`../public/sim-assets/models/${MODELS[board]}.parts.json`, import.meta.url), 'utf8')).map((p) => p.name)
  if (board === 'codebot') for (const [group, n] of [['user', 8], ['ls', 5], ['prox', 2], ['pwr', 1]]) for (let i = 0; i < n; i++) names.push(`LED_${group}_${i}`)
  return names
}

for (const name of ENGINES) {
  const browser = await playwright[name].launch(name === 'chromium' && process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
  for (const entry of index) {
    const pack = JSON.parse(readFileSync(new URL(entry.file, dir), 'utf8'))
    console.log(`${pack.id} (${pack.board}) in ${name}${DEVICE ? `, ${process.env.OCB_DEVICE}` : ''}`)
    const parts = partsOf(pack.board)
    const context = await browser.newContext(DEVICE ?? { viewport: { width: 1366, height: 900 } })
    const page = await context.newPage()
    page.on('pageerror', (e) => problems.push(`${pack.id}: page error: ${e.message}`))
    await page.addInitScript((board) => {
      if (sessionStorage.getItem('lpu')) return
      sessionStorage.setItem('lpu', '1')
      localStorage.clear()
      localStorage.setItem('opencodebot.welcomed.v1', '1')
      localStorage.setItem('opencodebot.device.v1', board)
    }, pack.board)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => !!window.openCodeBot)

    await page.click('#btn-learn')
    await page.waitForFunction(() => document.getElementById('modal')?.open)
    await page.click(`#modal [data-builtin="${pack.id}"]`)
    await page.waitForFunction((t) => document.querySelector('#learn-pane .learn-pack-title')?.textContent === t, pack.title, { timeout: 60000 })
    await page.click('#btn-sim')
    await page.waitForFunction(() => window.openCodeBot.device.state === 'ready', null, { timeout: 60000 })
    const pane = (sel) => page.locator(`#learn-pane ${sel}`)
    const drawerOpen = async () => {
      if ((await page.evaluate(() => document.querySelector('.workarea').dataset.drawer)) === 'closed') {
        await page.click('#learn-rail .rail-toggle')
        await page.waitForFunction(() => document.querySelector('.workarea').dataset.drawer === 'open')
      }
    }

    for (let m = 0; m < Math.min(MISSIONS, pack.missions.length); m++) {
      const mission = pack.missions[m]
      const objectives = mission.flow.filter((f) => f.type === 'objective')
      await drawerOpen()
      if (await pane('[data-learn="up"]').isVisible()) await pane('[data-learn="up"]').click()
      await pane(`[data-mission="${m}"]`).click()
      let met_ = 0
      let goals = 0
      for (const [step, item] of mission.flow.entries()) {
        await drawerOpen()
        await pane('[data-learn="next"]').click()
        // This step on show, not the one before (whose goals may look the same).
        await page.waitForFunction((s) => document.querySelector('#learn-pane .learn-count')?.textContent.match(/\d+/)?.[0] === s, `${step + 1}`)
        if (item.type !== 'objective') continue
        // Its goals are watched once the ones met before are read back (src/learn/learn.js).
        await page.waitForFunction((id) => window.openCodeBot.learn.watching?.objective.id === id, item.id, { timeout: 5000 })
        const i = objectives.indexOf(item)
        const checks = item.goals.flatMap((g) => leaves(g.check))
        const trek = item.trek?.length ? [item.code ?? '', ...item.trek.map((t) => t.python)].join('\n') : null
        const candidates = [objectives[i + 1]?.code, trek, item.code].filter((c) => c != null)
        const codeGoals = item.goals.filter((g) => leaves(g.check).every(isCode))
        const program = candidates.find((c) => codeGoals.every((g) => met(g.check, seenOf(c)))) ?? candidates.find((c) => codeGoals.some((g) => met(g.check, seenOf(c))))
        // Which goals this test can meet: not a code goal no program from the pack meets.
        const expected = item.goals.map((g) => leaves(g.check).filter(isCode).every((c) => program != null && met(c, seenOf(program))))
        if (program != null) {
          await page.evaluate((text) => {
            const app = window.openCodeBot
            if (app.workspace.mode !== 'text') app._toText()
            const view = app.pythonEditor.view
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
          }, program)
        }
        if (checks.some((c) => 'runs' in c || 'prints' in c)) {
          await page.waitForFunction(() => !document.getElementById('btn-run').disabled, null, { timeout: 30000 })
          await page.click('#btn-run')
          // Running, then stopped by itself or by Stop.
          await page.waitForFunction(() => !document.getElementById('btn-stop').hidden, null, { timeout: 15000 }).catch(() => {})
          const seconds = Math.max(4, ...checks.map((c) => (c.seconds ?? 0) + 1))
          await page.waitForFunction(() => document.getElementById('btn-stop').hidden, null, { timeout: seconds * 1000 }).catch(() => {})
          if (await page.isVisible('#btn-stop')) await page.click('#btn-stop')
          await page.waitForFunction(() => document.getElementById('btn-stop').hidden, null, { timeout: 15000 })
        }
        for (const c of checks.filter((c) => 'pick' in c)) {
          const part = parts.find((p) => new RegExp(c.pick).test(p))
          check(!!part, `${item.id}: a part matches ${c.pick}`)
          if (part) await page.evaluate((p) => window.openCodeBot.device.sim.dispatchEvent(new CustomEvent('pick', { detail: p })), part)
        }
        for (const c of checks.filter((c) => 'event' in c)) await page.evaluate(([n, d]) => window.openCodeBot.learn.event(n, d), [c.event, c.name])
        await drawerOpen()
        const want = expected.filter(Boolean).length
        await page
          .waitForFunction((exp) => {
            const lis = [...document.querySelectorAll('#learn-pane .learn-goals li')]
            return lis.length === exp.length && exp.every((e, i) => !e || lis[i].dataset.met === 'true')
          }, expected, { timeout: 10000 })
          .catch(() => {})
        const ticked = await page.$$eval('#learn-pane .learn-goals li', (lis) => lis.map((li) => li.dataset.met === 'true'))
        const missed = expected.map((e, n) => (e && !ticked[n] ? n + 1 : null)).filter(Boolean)
        goals += want
        met_ += want - missed.length
        if (missed.length) check(false, `${item.id}: goal ${missed.join(', ')} ticks`)
      }
      check(met_ === goals, `${mission.title}: ${met_} of ${goals} goals ticked, over ${objectives.length} objectives`)
    }
    await context.close()
  }
  await browser.close()
}

server?.kill()
if (problems.length) {
  console.error('\nFAILURES:')
  for (const p of problems) console.error(' -', p)
  process.exit(1)
}
console.log('\nAll good.')
