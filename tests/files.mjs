/**
 * The Files panel: pick a folder, see its files, open a Python file, see
 * when it is not saved, save it, make a new one; the folder comes back after
 * a reload. The folder picker cannot be answered in a headless browser, so
 * it hands over a folder in the browser's own private file system, which is
 * the same kind of handle a picked folder is. Run after `npm run build`.
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

await page.goto(URL_, { waitUntil: 'networkidle' })
// A folder with a program, a folder in it, a text file and a hidden file.
await page.evaluate(async () => {
  localStorage.clear()
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
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
})
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)

const text = () => page.evaluate(() => window.openCodeBot.pythonEditor.value)
const readFile = (path) =>
  page.evaluate(async (path) => {
    let d = await (await navigator.storage.getDirectory()).getDirectoryHandle('class-folder')
    const parts = path.split('/')
    const name = parts.pop()
    for (const p of parts) d = await d.getDirectoryHandle(p)
    return (await (await d.getFileHandle(name)).getFile()).text()
  }, path)
const items = () => page.$$eval('#files-panel .files-item', (b) => b.map((x) => x.textContent.trim()))
const dirty = () => page.evaluate(() => !document.getElementById('file-dirty').hidden)
/** Wait (up to 5 s) for something the app does without waiting: reading a folder, a file. */
const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).catch(() => {})

// ------------------------------------------------------------ a folder
await page.click('#btn-view')
await page.click('#btn-files')
await until(() => document.querySelector('#files-panel [data-act="pick"]'))
check(await page.isVisible('#files-panel [data-act="pick"]'), 'the Files panel offers to open a folder')
await page.click('#files-panel [data-act="pick"]')
await page.waitForSelector('#files-panel .files-item')
check(JSON.stringify(await items()) === JSON.stringify(['📁 lib', '🐍 main.py', '📄 notes.txt']), `the folder's files show, folders first, hidden files left out (${(await items()).join(', ')})`)
check(await page.evaluate(() => document.querySelector('.files-item.is-other')?.getAttribute('aria-disabled') === 'true'), 'a file that is not Python cannot be opened')
await page.click('.files-item:has-text("lib")')
await page.waitForSelector('.files-item:has-text("helpers.py")')
check(await page.isVisible('.files-item:has-text("helpers.py")'), 'a folder opens to show what is in it')

// ------------------------------------------------------------ open, edit, save
await page.click('.files-item:has-text("main.py")')
await until(() => document.getElementById('file-name').textContent === 'main.py')
check((await text()) === 'from botcore import *\nleds.user(0xFF)\n', 'opening main.py puts it in the Python editor')
check((await page.evaluate(() => window.openCodeBot.workspace.mode)) === 'text', 'and it is typed Python (text mode)')
check((await page.textContent('#file-name')) === 'main.py' && !(await dirty()), 'the bar shows main.py, saved')
check(await page.isVisible('.files-item.is-current:has-text("main.py")'), 'the open file is marked in the tree')
await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('print("changed")\n')
await page.waitForTimeout(400)
check(await dirty(), 'a change shows the file is not saved')
await page.keyboard.press('Control+s')
await until(() => document.getElementById('file-dirty').hidden)
await until(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('main.py')))
check((await readFile('main.py')).includes('print("changed")'), 'Ctrl+S saves the program into main.py')
check(!(await dirty()), 'and the bar shows it saved')

// ------------------------------------------------------------ opening over unsaved work asks
await page.keyboard.type('x = 1\n')
await page.waitForTimeout(400)
await page.click('.files-item:has-text("helpers.py")')
await until(() => document.getElementById('modal')?.open)
check(await page.evaluate(() => document.getElementById('modal')?.open), 'opening another file over unsaved work asks first')
await page.click('#modal button[value="cancel"]')
check((await text()).includes('x = 1'), '"Keep mine" keeps the program')
await page.click('.files-item:has-text("helpers.py")')
await until(() => document.getElementById('modal')?.open)
await page.click('#modal button[value="ok"]')
await until(() => document.getElementById('file-name').textContent === 'helpers.py')
check((await text()).startsWith('def helper():') && (await page.textContent('#file-name')) === 'helpers.py', 'confirming opens lib/helpers.py')

// ------------------------------------------------------------ a new file
await page.click('#files-panel [data-act="new"]')
await page.fill('#files-name', 'a/b')
await page.click('#files-panel .files-form button[type="submit"]')
check((await page.textContent('#files-panel .files-error')).length > 0, 'a name with a slash is refused')
await page.fill('#files-name', 'main')
await page.click('#files-panel .files-form button[type="submit"]')
await until(() => document.querySelector('#files-panel .files-error').textContent.includes('main.py'))
check((await page.textContent('#files-panel .files-error')).includes('main.py'), 'a name already in the folder is refused')
await page.fill('#files-name', 'dance')
await page.click('#files-panel .files-form button[type="submit"]')
await page.waitForSelector('.files-item:has-text("dance.py")')
check((await readFile('dance.py')).startsWith('def helper():'), 'New file makes dance.py holding the program')
check((await page.textContent('#file-name')) === 'dance.py', 'and it becomes the open file')

// ------------------------------------------------------------ after a reload
await page.waitForTimeout(400)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForFunction(() => !!window.openCodeBot)
check((await page.textContent('#file-name')) === 'dance.py', 'after a reload the bar still names the open file')
await page.click('#btn-files')
await until(() => document.querySelector('#files-panel [data-act="reopen"]'))
check(await page.isVisible('#files-panel [data-act="reopen"]:has-text("class-folder")'), 'and the panel offers to open class-folder again')
await page.click('#files-panel [data-act="reopen"]')
await page.waitForSelector('.files-item:has-text("dance.py")')
check(await page.isVisible('.files-item.is-current:has-text("dance.py")'), 'the folder comes back, with dance.py marked')
await page.click('#python-editor .cm-content')
await page.keyboard.press('Control+End')
await page.keyboard.type('# more\n')
await page.click('#btn-file-save')
let saved = false
for (let i = 0; i < 25 && !saved; i++) {
  saved = (await readFile('dance.py')).includes('# more')
  if (!saved) await page.waitForTimeout(200)
}
check(saved, `Save saves into the reopened folder${saved ? '' : ` (${await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '))}; editor ${JSON.stringify(await text())})`}`)

// ------------------------------------------------------------ a new project lets the file go
await page.evaluate(() => window.openCodeBot.workspace.clear())
await page.waitForTimeout(100)
check(await page.isHidden('#file-tab'), 'a new project is no longer the open file')

// ------------------------------------------------------------ a browser with no folders
const plain = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await plain.addInitScript(() => {
  delete window.showDirectoryPicker
})
const p2 = await plain.newPage()
await p2.goto(URL_, { waitUntil: 'networkidle' })
await p2.evaluate(() => {
  localStorage.setItem('opencodebot.welcomed.v1', '1')
  localStorage.setItem('opencodebot.device.v1', 'codebot')
})
await p2.reload({ waitUntil: 'networkidle' })
await p2.waitForFunction(() => !!window.openCodeBot)
await p2.click('#btn-view')
await p2.click('#btn-files')
check(await p2.isVisible('#files-panel .files-note'), 'where folders cannot be opened, the panel says so')
await p2.setInputFiles('#files-panel .files-single', { name: 'robot.py', mimeType: 'text/x-python', buffer: Buffer.from('print("one file")\n') })
await p2.waitForFunction(() => window.openCodeBot.pythonEditor.value.includes('one file'), null, { timeout: 5000 }).catch(() => {})
check((await p2.evaluate(() => window.openCodeBot.pythonEditor.value)) === 'print("one file")\n', 'and opens a single Python file instead')

await browser.close()
server?.kill()
if (problems.length) {
  console.log('\nFAILURES:')
  for (const p of problems) console.log(` - ${p}`)
  process.exit(1)
}
console.log('\nAll good.')
