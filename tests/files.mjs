/**
 * The file browser: every program is a Python file, kept in this browser or
 * in a folder on the computer. Use a folder (copying the open program into
 * it), open its files, have work save itself, make files and folders, rename
 * and delete them, find it all again after a reload (and say loudly when the
 * folder must be allowed again). With no folder access (Firefox, Safari) the
 * browser's own files do it all. A file made in blocks opens as it was left,
 * and a file for another board switches to that board.
 *
 * The folder picker cannot be answered in a headless browser, so it hands
 * over a folder in the browser's own private file system, which is the same
 * kind of handle a picked folder is. Run after `npm run build`.
 */
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const BASE = process.env.OCB_URL || 'http://localhost:4173/'
const URL_ = `${BASE}?device=loopback&board=codebot`

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
await context.addInitScript(() => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('class-folder', { create: true })
})
const page = await context.newPage()
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))

/** A fresh start: no saved program, no browser files, and (for `page`) a folder with a program, a folder in it, a text file and a hidden file. */
async function fresh(p, folder) {
  await p.goto(URL_, { waitUntil: 'networkidle' })
  await p.evaluate(async (folder) => {
    localStorage.clear()
    localStorage.setItem('opencodebot.welcomed.v1', '1')
    localStorage.setItem('opencodebot.device.v1', 'codebot')
    await new Promise((r) => { const q = indexedDB.deleteDatabase('opencodebot-browser-files'); q.onsuccess = q.onerror = q.onblocked = r })
    await new Promise((r) => { const q = indexedDB.deleteDatabase('opencodebot-files'); q.onsuccess = q.onerror = q.onblocked = r })
    if (!folder) return
    const root = await navigator.storage.getDirectory()
    await root.removeEntry('class-folder', { recursive: true }).catch(() => {})
    const dir = await root.getDirectoryHandle('class-folder', { create: true })
    const put = async (d, name, text) => {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable()
      await w.write(text)
      await w.close()
    }
    await put(dir, 'main.py', 'from botcore import *\nleds.user(0xFF)\n')
    await put(dir, 'notes.txt', 'not Python')
    await put(dir, '.secret', 'hidden')
    await put(await dir.getDirectoryHandle('lib', { create: true }), 'helpers.py', 'def helper():\n    return 1\n')
  }, folder)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForFunction(() => !!window.openCodeBot?.openFile)
}
await fresh(page, true)

const text = () => page.evaluate(() => window.openCodeBot.pythonEditor.value)
const readFile = (path) =>
  page.evaluate(async (path) => {
    try {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('class-folder')
      const parts = path.split('/')
      const name = parts.pop()
      for (const p of parts) d = await d.getDirectoryHandle(p)
      return (await (await d.getFileHandle(name)).getFile()).text()
    } catch {
      return null
    }
  }, path)
const items = (store) => page.$$eval(`#files-panel .files-section[data-store="${store}"] .files-item`, (b) => b.map((x) => x.textContent.trim()))
const dirty = () => page.evaluate(() => !document.getElementById('file-dirty').hidden)
const fileName = () => page.textContent('#file-name')
/** Wait (up to 5 s) for something the app does without waiting: reading a folder, saving a file. */
const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {})
const row = (store, path) => `#files-panel .files-row:has(.files-item[data-store="${store}"][data-path="${path}"])`
const nameIt = async (name) => {
  await page.fill('#files-name', name)
  await page.press('#files-name', 'Enter')
}

// ------------------------------------------------------------ the bar, before a folder
check((await fileName()) === 'main.py', 'the bar names the program\'s file, main.py, from the start')
await page.click('#btn-files')
await until(() => document.querySelector('#files-panel [data-act="attach"]'))
check(await page.isVisible('#files-panel [data-act="attach"]'), 'with no folder yet, the browser offers to use one')
check(JSON.stringify(await items('browser')) === JSON.stringify(['🐍 main.py']), `and lists this browser's files (${(await items('browser')).join(', ')})`)
check(await page.isVisible('.files-item.is-current:has-text("main.py")'), 'with the open file marked')

// ------------------------------------------------------------ a folder: copy the program in
await page.click('#files-panel [data-act="attach"]')
await until(() => document.getElementById('modal')?.open)
check(await page.evaluate(() => document.getElementById('modal')?.open), 'using a folder offers to copy the program into it')
await page.click('#modal button[value="ok"]')
await until(() => window.openCodeBot.openFile?.store === 'folder')
check((await fileName()) === 'main-2.py' && (await readFile('main-2.py')) !== null, 'copied in as main-2.py (main.py was taken), and that is the open file now')
await page.waitForSelector('#files-panel .files-section[data-store="folder"] .files-item')
check(JSON.stringify(await items('folder')) === JSON.stringify(['📁 lib', '🐍 main-2.py', '🐍 main.py', '📄 notes.txt']), `the folder's files show, folders first, hidden files left out (${(await items('folder')).join(', ')})`)
await until(() => document.querySelector('#files-panel .files-section[data-store="browser"] .files-item'))
check((await items('browser')).includes('🐍 main.py'), 'and this browser\'s files stay listed below it')
check(await page.evaluate(() => document.querySelector('.files-item.is-other')?.getAttribute('aria-disabled') === 'true'), 'a file that is not Python cannot be opened')
await page.click('.files-item:has-text("lib")')
await page.waitForSelector('.files-item:has-text("helpers.py")')
check(await page.isVisible('.files-item:has-text("helpers.py")'), 'a folder opens to show what is in it')

// ------------------------------------------------------------ open in Python, edit, saved by itself
await page.click('#btn-view')
await page.click(`${row('folder', 'main.py')} .files-item`)
await until(() => document.getElementById('file-name').textContent === 'main.py')
check((await text()) === 'from botcore import *\nleds.user(0xFF)\n', 'opening main.py in the Python view puts it in the editor')
check((await fileName()) === 'main.py' && !(await dirty()), 'the bar shows main.py, saved')
await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('print("changed")\n')
await until(() => !document.getElementById('file-dirty').hidden)
check(await dirty(), 'a change shows the dot while it waits')
await until(() => document.getElementById('file-dirty').hidden)
check((await readFile('main.py'))?.includes('print("changed")') && !(await dirty()), 'and saves itself into main.py, with nothing pressed')

// ------------------------------------------------------------ another file: nothing asks, nothing is lost
await page.keyboard.type('x = 1\n')
await page.click('.files-item:has-text("helpers.py")')
await until(() => document.getElementById('file-name').textContent === 'helpers.py')
check(!(await page.evaluate(() => document.getElementById('modal')?.open)), 'opening another file does not ask')
check((await readFile('main.py'))?.includes('x = 1'), 'the last change was saved first')
check((await text()).startsWith('def helper():'), 'lib/helpers.py opens')

// In blocks, a file opens as its blocks; untouched, its Python is kept as typed.
await page.click('#btn-view')
await until(() => window.openCodeBot.workspace.mode === 'blocks')
await page.click(`${row('folder', 'main.py')} .files-item`)
await until(() => document.getElementById('file-name').textContent === 'main.py')
const asBlocks = await page.evaluate(() => ({ mode: window.openCodeBot.workspace.mode, n: window.openCodeBot.workspace.workspace.getAllBlocks(false).length }))
check(asBlocks.mode === 'blocks' && asBlocks.n > 0, `in blocks, main.py opens as blocks (${asBlocks.n})`)
await page.waitForTimeout(1200)
check((await readFile('main.py')) === 'from botcore import *\nleds.user(0xFF)\nprint("changed")\nx = 1\n', 'only looked at, the file is not rewritten')

// ------------------------------------------------------------ new files and folders
await page.click('#files-panel .files-section[data-store="folder"] .files-head [data-act="new-file"]')
await nameIt('a/b')
check((await page.textContent('#files-panel .files-error')).length > 0, 'a name with a slash is refused')
await nameIt('main')
await until(() => document.querySelector('#files-panel .files-error').textContent.includes('main.py'))
check((await page.textContent('#files-panel .files-error')).includes('main.py'), 'a name already there is refused')
await nameIt('dance')
await until(() => document.getElementById('file-name').textContent === 'dance.py')
check((await readFile('dance.py')) === '' && (await fileName()) === 'dance.py', 'New file makes an empty dance.py, and opens it')
check(await page.evaluate(() => window.openCodeBot.workspace.hasNoBlocks), 'with nothing on the canvas')
await page.click('#files-panel .files-section[data-store="folder"] .files-head [data-act="new-dir"]')
await nameIt('songs')
await page.waitForSelector('.files-item:has-text("songs")')
check(await page.isVisible('.files-item[data-kind="dir"]:has-text("songs")'), 'New folder makes the folder songs')
await page.hover(row('folder', 'songs'))
await page.click(`${row('folder', 'songs')} [data-act="new-file"]`)
await nameIt('tune')
await until(() => document.getElementById('file-name').textContent === 'tune.py')
check((await readFile('songs/tune.py')) === '' && (await page.evaluate(() => window.openCodeBot.openFile.path)) === 'songs/tune.py', 'a new file in a folder goes in it')

// ------------------------------------------------------------ rename and delete
await page.click(`${row('folder', 'dance.py')} .files-item`)
await until(() => document.getElementById('file-name').textContent === 'dance.py')
await page.click(`${row('folder', 'dance.py')} [data-act="rename"]`)
check((await page.inputValue('#files-name')) === 'dance.py', 'rename starts from the name')
await nameIt('jig')
await until(() => document.getElementById('file-name').textContent === 'jig.py')
check((await readFile('jig.py')) === '' && (await readFile('dance.py')) === null, 'renaming the open file renames it in the folder')
check((await fileName()) === 'jig.py', 'and the bar follows')
await page.hover(row('folder', 'songs/tune.py'))
await page.click(`${row('folder', 'songs/tune.py')} [data-act="delete"]`)
await until(() => document.getElementById('modal')?.open)
check(await page.evaluate(() => document.getElementById('modal')?.open), 'delete asks first')
await page.click('#modal button[value="ok"]')
await until(() => !document.querySelector('.files-item[data-path="songs/tune.py"]'))
check((await readFile('songs/tune.py')) === null, 'and then deletes the file')
await page.click(`${row('folder', 'jig.py')} [data-act="delete"]`)
await until(() => document.getElementById('modal')?.open)
await page.click('#modal button[value="ok"]')
await until(() => document.getElementById('file-name').textContent !== 'jig.py')
check((await readFile('jig.py')) === null && /\.py$/.test(await fileName()), `deleting the open file opens another (${await fileName()})`)

// ------------------------------------------------------------ after a reload: allow the folder again
await page.click(`${row('folder', 'main.py')} .files-item`)
await until(() => document.getElementById('file-name').textContent === 'main.py')
await page.waitForTimeout(1200)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await fileName()) === 'main.py', 'after a reload the bar still names the open file')
await page.evaluate(() => window.openCodeBot.workspace.workspace.newBlock('ocb_print').initSvg())
await until(() => !document.getElementById('btn-save-again').hidden)
check(await page.isVisible('#btn-save-again'), 'a save that needs the folder allowed again says so in the bar')
check(await page.evaluate(() => document.getElementById('editor-bar').classList.contains('is-failed')), 'loudly')
await page.click('#btn-save-again')
await until(() => document.getElementById('btn-save-again').hidden)
check(!(await page.isVisible('#btn-save-again')) && (await readFile('main.py'))?.includes('print('), 'one click allows it, and the program is saved')

// ------------------------------------------------------------ a browser with no folders
const plain = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await plain.addInitScript(() => {
  delete window.showDirectoryPicker
})
const p2 = await plain.newPage()
p2.on('pageerror', (e) => problems.push(`page error (no folders): ${e.message}`))
await fresh(p2, false)
check((await p2.textContent('#file-name')) === 'main.py', 'with no folder access, the program is still main.py')
await p2.click('#btn-files')
await p2.waitForSelector('#files-panel .files-section[data-store="browser"]')
check(!(await p2.isVisible('#files-panel [data-act="attach"]')), 'and no folder is offered')
await p2.click('#files-panel .files-head [data-act="new-file"]')
await p2.fill('#files-name', 'robot')
await p2.press('#files-name', 'Enter')
await p2.waitForFunction(() => window.openCodeBot.openFile?.path === 'robot.py')
check(true, 'a new file is made in this browser')

// A file made in blocks opens again as it was left.
await p2.evaluate(() => {
  const ws = window.openCodeBot.workspace.workspace
  const b = ws.newBlock('ocb_print')
  b.initSvg()
  b.render()
  b.moveBy(333, 222)
})
await p2.waitForTimeout(1200)
const where = () => p2.evaluate(() => window.openCodeBot.workspace.workspace.getTopBlocks(false).map((b) => `${b.type}@${Math.round(b.getRelativeToSurfaceXY().x)},${Math.round(b.getRelativeToSurfaceXY().y)}`).join())
const left = await where()
await p2.click('.files-item:has-text("main.py")')
await p2.waitForFunction(() => window.openCodeBot.openFile?.path === 'main.py')
await p2.click('.files-item:has-text("robot.py")')
await p2.waitForFunction(() => window.openCodeBot.openFile?.path === 'robot.py')
check((await where()) === left, `a blocks file opens as it was left (${left})`)

// A file for another board switches to that board.
await p2.evaluate(() => window.openCodeBot.stores.browser.write('screen.py', 'from codex import *\ndisplay.show("hi")\n'))
await p2.evaluate(() => window.openCodeBot._renderFiles())
await p2.click('.files-item:has-text("screen.py")')
await p2.waitForFunction(() => window.openCodeBot.openFile?.path === 'screen.py')
check((await p2.evaluate(() => window.openCodeBot.workspace.targetId)) === 'codex', 'a CodeX program switches the board to CodeX')

await browser.close()
server?.kill()
if (problems.length) {
  console.log('\nFAILURES:')
  for (const p of problems) console.log(` - ${p}`)
  process.exit(1)
}
console.log('\nAll good.')
