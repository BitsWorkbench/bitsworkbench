/**
 * Learn's mission packs in the app: opening a pack (from a file, or one kept
 * from before), the tutorial pane at the right of the work area and its
 * divider, and which pack was open, so a reload comes back to it.
 */
import { t } from '../i18n/index.js'
import { toast } from '../ui/notify.js'
import { Library } from './library.js'
import { PackError } from './pack.js'
import { Tutorial } from './tutorial.js'
import { GoalWatcher } from './goals.js'
import { RegexTester } from './regex.js'

const OPEN = 'opencodebot.learn.v1' // { id, width }
const MIN_WIDTH = 260
const MIN_REST = 560 // the editor and the side pane's own minimums, and the dividers

export class Learn {
  /**
   * `pane`, `splitter`, `workarea`: the elements; `onResize()` after the pane
   * opens, closes or changes width, for the editor and the side to fit again;
   * `device`, the app's device, and `program()`, the student's program as
   * Python, for the goals; `onTrek(trek)` with the CodeTrek of the objective
   * on show (null when none is), for the palettes.
   */
  constructor({ pane, splitter, workarea, onResize, device, program, onTrek }) {
    this.pane = pane
    this.splitter = splitter
    this.workarea = workarea
    this.onResize = onResize
    this.onTrek = onTrek
    this.library = new Library()
    this.tutorial = new Tutorial(pane)
    this.tutorial.addEventListener('place', (e) => {
      this.library.setPlace(this.tutorial.pack.id, e.detail)
      this._watch()
    })
    this.tutorial.addEventListener('close', () => this.close())
    this.watcher = new GoalWatcher({ device, program, tester: new RegexTester() })
    this.watcher.addEventListener('goals', (e) => this._goalsMet(e.detail))
    this._bindSplitter()
  }

  /** The student's program changed. */
  programChanged() {
    this.watcher.programChanged()
  }

  /** Something the student did that a goal can ask for (docs/mission-packs.md, `event`). */
  event(name, detail) {
    this.watcher.event(name, detail)
  }

  /** Watch the objective on show, if one is, starting from the goals met before. */
  async _watch() {
    const pack = this.tutorial.pack
    const objective = this.isOpen && this.tutorial.objective
    this.watcher.stop()
    this.watching = null
    this.onTrek(objective?.trek ?? null)
    if (!objective) return
    const before = await this.library.goals(pack.id, objective.id)
    if (this.tutorial.objective !== objective) return
    this.tutorial.setDone(before)
    this.watching = { pack, objective }
    this.watcher.start(objective.goals, before)
  }

  async _goalsMet(done) {
    const watching = this.watching
    if (!watching) return
    await this.library.setGoals(watching.pack.id, watching.objective.id, done)
    const finished = await this.library.finished(watching.pack)
    if (this.tutorial.objective === watching.objective) this.tutorial.setDone(done, finished)
  }

  /** The packs kept in this browser. */
  packs() {
    return this.library.list()
  }

  /** Reopen the pack that was open before the page loaded, if any. */
  async restore() {
    const saved = this._saved()
    if (saved.id) await this.open(saved.id, { quiet: true })
  }

  /** Open a kept pack where the student left it. */
  async open(id, { quiet = false } = {}) {
    const pack = await this.library.get(id).catch(() => null)
    if (!pack) {
      if (!quiet) toast({ kind: 'error', title: t('learn.gone') })
      this._save({ id: null })
      return
    }
    this.tutorial.finished = await this.library.finished(pack)
    this.tutorial.show(pack, await this.library.place(id))
    this._save({ id })
    this._setOpen(true)
    this._watch()
  }

  /** A pack file the student picked: kept, then opened; or why it cannot be. */
  async openFile(file) {
    if (!file) return
    let pack
    try {
      pack = await this.library.add(await file.text())
    } catch (err) {
      const problems = err instanceof PackError ? err.problems : [err.message]
      console.warn(`${file.name}: not a pack Codacious can open\n${problems.join('\n')}`)
      toast({ kind: 'error', title: t('learn.badPack', { name: file.name }), detail: problems.slice(0, 3).join('\n') })
      return
    }
    await this.open(pack.id)
    toast({ kind: 'info', title: t('learn.opened', { title: pack.title }) })
  }

  close() {
    this._save({ id: null })
    this._setOpen(false)
    this._watch()
  }

  /** 'blocks' or 'python': the tutorial shows that mode's text. A change is the `switched` event. */
  setMode(mode) {
    if (this.tutorial.mode !== mode) this.event('switched')
    this.tutorial.setMode(mode)
  }

  get isOpen() {
    return !this.pane.hidden
  }

  /** The pane's width and its divider's, in pixels, while it is open beside the side pane. */
  get width() {
    if (this.pane.hidden || this._stacked()) return 0
    return this.pane.getBoundingClientRect().width + this.splitter.getBoundingClientRect().width
  }

  _setOpen(open) {
    this.pane.hidden = !open
    this.splitter.hidden = !open
    this.workarea.dataset.learn = open ? 'open' : 'closed'
    if (open) this._setWidth(this._saved().width ?? 380)
    this.onResize()
  }

  _stacked() {
    return window.matchMedia('(max-width: 880px)').matches
  }

  _setWidth(px) {
    const room = this.workarea.getBoundingClientRect().width - MIN_REST
    const width = Math.round(Math.max(MIN_WIDTH, Math.min(px, room)))
    this.workarea.style.setProperty('--learn-w', `${width}px`)
    this.splitter.setAttribute('aria-valuenow', String(width))
    return width
  }

  _bindSplitter() {
    const s = this.splitter
    let dragging = false
    const set = (px) => {
      this._save({ width: this._setWidth(px) })
      this.onResize()
    }
    s.addEventListener('pointerdown', (e) => {
      dragging = true
      s.setPointerCapture(e.pointerId)
    })
    s.addEventListener('pointermove', (e) => {
      if (dragging) set(this.workarea.getBoundingClientRect().right - e.clientX)
    })
    s.addEventListener('pointerup', () => (dragging = false))
    s.addEventListener('keydown', (e) => {
      const grow = { ArrowLeft: 40, ArrowRight: -40 }[e.key]
      if (!grow) return
      e.preventDefault()
      set(this.pane.getBoundingClientRect().width + (e.shiftKey ? grow * 3 : grow))
    })
  }

  _saved() {
    try {
      return JSON.parse(localStorage.getItem(OPEN)) || {}
    } catch {
      return {}
    }
  }

  _save(change) {
    try {
      localStorage.setItem(OPEN, JSON.stringify({ ...this._saved(), ...change }))
    } catch {
      // Private browsing without storage: the pane just does not come back after a reload.
    }
  }
}
