/**
 * Learn's mission packs in the app: opening a pack (from a file, or one kept
 * from before); while one is open, the mission rail at the right edge and the
 * tutorial in a drawer that slides out from it over the simulator and the
 * terminal; and which pack was open and whether its drawer was, so a reload
 * comes back to them.
 */
import { t } from '../i18n/index.js'
import { toast, showModal, choose } from '../ui/notify.js'
import { getTarget } from '../device/targets.js'
import { isGuided, journeyOf, chapterStates, missionStates, firstToDo, runOn, setRunOn, runChoice, missionsHtml, unlockWarning, chapterUnlocked, MISSION_UNLOCKED } from './guide.js'
import { Library } from './library.js'
import { PackError, named } from './pack.js'
import { Tutorial, loadMarkdown } from './tutorial.js'
import { GoalWatcher } from './goals.js'
import { RegexTester } from './regex.js'
import { offersBlocks } from './offer.js'
import { BRAND } from '../brand.js'
import { Rail } from './rail.js'
import { Journey } from './journey/journey.js'
import { Effects } from './journey/effects.js'
import { Places } from './journey/places.js'

const OPEN = 'opencodebot.learn.v1' // { id, drawer: false when the student closed it }

export class Learn {
  /**
   * `pane`, `rail`, `workarea`: the elements; `onResize()` after the rail
   * comes or goes, for the editor and the side to fit again;
   * `device`, the app's device, and `program()`, the student's program as
   * Python, for the goals; `onTrek(trek)` with the CodeTrek of the objective
   * on show (null when none is), for the palettes; `blocksFromPython(python,
   * board)`, the app's Python to blocks, to judge whether an objective is
   * taught in blocks; `toPython()` when the student asks to switch to Python.
   * For journeys: `blocks`, the BlockWorkspace; `simView()`, the simulator's
   * view while it is open; `useFile(...)`, to work in a journey's file
   * (journey.js: true once it is open, the student's work never lost);
   * `switchMode(mode)`, back to the mode a paused journey is in.
   * For guided packs (guide.js): `prepare({ board, runOn })`, the board up in
   * the simulator or on USB (false when the board on USB did not connect);
   * `stage(step, { board, runOn })`, what a step points at put on screen;
   * `onOpen(open)` when a pack opens or closes (the Learn button follows).
   */
  constructor({ pane, rail, workarea, onResize, device, program, onTrek, blocksFromPython, toPython, blocks, simView, useFile, switchMode, prepare = async () => true, stage = () => {}, onOpen = () => {} }) {
    this.prepare = prepare
    this.onOpen = onOpen
    this.guided = false
    this.pane = pane
    this.railEl = rail
    this.workarea = workarea
    this.onResize = onResize
    this.onTrek = onTrek
    this.library = new Library()
    const offered = new WeakMap() // objective: taught in blocks? Packs do not change once read.
    this.tutorial = new Tutorial(pane, {
      offersBlocks: (objective, board) => {
        if (!offered.has(objective)) offered.set(objective, offersBlocks(objective, board, blocksFromPython))
        return offered.get(objective)
      },
    })
    this.tutorial.addEventListener('python', () => toPython())
    this.tutorial.addEventListener('place', (e) => {
      this.library.setPlace(this.tutorial.pack.id, e.detail)
      this._watch()
    })
    this.tutorial.addEventListener('close', () => this.close())
    this.tutorial.addEventListener('shown', () => this._drawRail())
    this.rail = new Rail(rail, { controls: pane.id })
    this.rail.addEventListener('toggle', () => (this.drawerOpen ? this.collapse() : this.expand()))
    this.rail.addEventListener('missions', () => this._missionsCard())
    this.rail.addEventListener('chapter', (e) => this._goChapter(e.detail))
    this.rail.addEventListener('go', (e) => {
      this.expand()
      this.tutorial.go(e.detail)
    })
    // Escape puts the drawer away, and the student is back at the rail's button.
    pane.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      this.collapse()
    })
    const tester = new RegexTester()
    this.watcher = new GoalWatcher({ device, program, tester })
    this.watcher.addEventListener('goals', (e) => this._goalsMet(e.detail))

    const box = (sel) => {
      const r = document.querySelector(sel)?.getBoundingClientRect()
      return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
    }
    const places = new Places({ blocks, sim: simView })
    this.journey = new Journey({
      places,
      effects: new Effects({ places }),
      md: (text, mode) => this.tutorial.mdFor(text, mode),
      watcher: new GoalWatcher({ device, program, tester }),
      library: this.library,
      side: () => ({ sim: box('#panel-sim'), terminal: box('#panel-terminal') }),
      useFile,
      // In a guided pack the controller has the screen: what each step points at comes back into view.
      stage: (step) => this.guided && stage(step, { board: this._board(), runOn: this.runOn }),
    })
    this.tutorial.addEventListener('journey', (e) => this._startJourney(e.detail.chapter))
    this.journey.addEventListener('progress', () => this._journeyProgress())
    this.journey.addEventListener('place', () => this.guided && this._drawRail())
    this.journey.addEventListener('exit', () => {
      this._save({ journey: false })
      // Leaving the guide of a guided pack leaves the tutorial: there is no drawer to go back to.
      if (this.guided) return this.close()
      this.expand()
    })
    this.journey.addEventListener('switch-mode', (e) => switchMode(e.detail))
    this.journey.addEventListener('finished', () => {
      this._save({ journey: false })
      if (this.guided) return this._nextMission()
      this.tutorial.go({ ...this.tutorial.place, step: this.tutorial.place.step + 1 })
      this.expand()
    })
  }

  // ------------------------------------------------------- guided packs

  /** The board the mission on show runs on. */
  _board() {
    const pack = this.tutorial.pack
    return this.tutorial.objective?.board || pack?.board
  }

  /** Every mission's journey progress, in order. */
  _progresses(pack) {
    return Promise.all(pack.missions.map((m) => this.library.goals(pack.id, journeyOf(m).id)))
  }

  /**
   * Begin a guided mission (the first not done for null): the student's
   * choice of simulator or board, asked once for the pack; the board up; then
   * the coach, at its opening card or where the student left off.
   */
  async _beginMission(mi) {
    const pack = this.tutorial.pack
    if (mi === null || !pack.missions[mi]) mi = firstToDo(missionStates(await this._progresses(pack)))
    this.journey.stop()
    this.tutorial.go({ mission: mi, step: 0 })
    const device = getTarget(this._board())?.name || this._board()
    let how = runOn(pack.id)
    if (!how) {
      how = await choose(runChoice(device))
      // Closed without a choice: nothing starts, and the student is out of the tutorial.
      if (!how) return this.close()
      setRunOn(pack.id, how)
    }
    this.runOn = how
    if (!(await this._prepare(device))) return
    if (this.tutorial.pack !== pack || this.tutorial.place?.mission !== mi) return
    if (!(await this.journey.start(pack, this.tutorial.objective, this.tutorial.mode))) return
    this._save({ journey: true })
    this._drawRail()
  }

  /** The board up as the student chose; a board that would not connect offers the simulator. False if they gave up. */
  async _prepare(device) {
    while (!(await this.prepare({ board: this._board(), runOn: this.runOn }))) {
      const how = await choose({ ...runChoice(device), title: t('guide.noBoardTitle', { device }), bodyHtml: `<p>${t('guide.noBoardBody', { device })}</p>` })
      if (!how) {
        this.close()
        return false
      }
      this.runOn = how
      setRunOn(this.tutorial.pack.id, how)
    }
    return true
  }

  /** The pack's missions, from the rail: go to one (a locked one asks first), or change how they run. */
  async _missionsCard() {
    const pack = this.tutorial.pack
    if (!pack) return
    const states = missionStates(await this._progresses(pack))
    const current = this.tutorial.place?.mission ?? -1
    const device = getTarget(this._board())?.name || this._board()
    let picked = null
    let change = false
    const closed = showModal({ title: pack.title, bodyHtml: missionsHtml(pack, states, current, this.runOn, device), confirmText: t('examples.close') })
    const dialog = document.getElementById('modal')
    const onClick = (e) => {
      const m = e.target.closest('[data-guide-mission]')
      if (m) {
        picked = Number(m.dataset.guideMission)
        dialog.close('pick')
      } else if (e.target.closest('[data-guide-run]')) {
        change = true
        dialog.close('run')
      }
    }
    dialog.addEventListener('click', onClick)
    await closed
    dialog.removeEventListener('click', onClick)
    if (change) {
      const how = await choose(runChoice(device))
      if (!how || how === this.runOn) return
      setRunOn(pack.id, how)
      this.runOn = how
      if (await this._prepare(device)) this.journey.stage?.(null)
      return
    }
    if (picked === null) return
    if (states[picked] === 'locked') {
      // Only the next one unlocks, whichever locked one was picked.
      const k = states.indexOf('locked')
      const mission = pack.missions[k]
      if ((await choose(unlockWarning('mission', mission.title))) !== 'unlock') return
      const j = journeyOf(mission)
      await this.library.setGoals(pack.id, j.id, [...(await this.library.goals(pack.id, j.id)), MISSION_UNLOCKED])
      picked = k
    }
    if (picked === current && this.journey.running) return
    await this._beginMission(picked)
  }

  /** A chapter from the rail: played from its start, progress kept; a locked one asks first, then only the next one unlocks. */
  async _goChapter(i) {
    const item = this.tutorial.objective
    if (!this.guided || item?.type !== 'journey') return
    if (!this.journey.running || this.journey.item !== item) await this._beginMission(this.tutorial.place.mission)
    if (!this.journey.running) return
    const states = chapterStates(item, [...this.journey.done], this.tutorial.mode)
    if (states[i] === 'locked') {
      const k = states.indexOf('locked')
      const chapter = item.chapters[k]
      if ((await choose(unlockWarning('chapter', chapter.title))) !== 'unlock') return
      await this.journey.mark(chapterUnlocked(chapter))
      i = k
    }
    await this.journey.goChapter(i)
  }

  /** A guided mission finished: the next one begins; after the last, the pack's own words, then out of the tutorial. */
  async _nextMission() {
    const pack = this.tutorial.pack
    const next = this.tutorial.place.mission + 1
    if (next < pack.missions.length) return this._beginMission(next)
    await showModal({
      title: t('guide.packDoneTitle', { title: pack.title }),
      bodyHtml: this.tutorial.mdFor(pack.complete, this.tutorial.mode) || `<p>${t('guide.packDone')}</p>`,
      confirmText: t('btn.exitTutorial'),
    })
    this.close()
  }

  /** Hand the journey on show over to the coach: the drawer goes, the coach comes. */
  async _startJourney(chapter) {
    const item = this.tutorial.objective
    if (item?.type !== 'journey') return
    // A chapter started over asks first when it would replace the student's work: kept working, nothing changes.
    if (!(await this.journey.start(this.tutorial.pack, item, this.tutorial.mode, { chapter }))) return
    this.collapse()
    this._save({ journey: true })
  }

  async _journeyProgress() {
    const pack = this.tutorial.pack
    const item = this.tutorial.objective
    if (!pack || item?.type !== 'journey') return
    this.tutorial.journeyProgress = await this.library.goals(pack.id, item.id)
    this.tutorial.finished = await this.library.finished(pack)
    this.tutorial.refresh()
    this._drawRail()
  }

  /** Whether the drawer is out (a pack is open and the student has not put it away). */
  get drawerOpen() {
    return this.isOpen && this.workarea.dataset.drawer === 'open'
  }

  /** Slide the drawer out, and take the student into it. */
  expand() {
    if (!this.isOpen || this.guided) return
    this._setDrawer(true)
    this.pane.querySelector('.learn-body')?.focus({ preventScroll: true })
  }

  /** Put the drawer away (Run does, so the simulator and the terminal are in view). */
  collapse() {
    if (!this.drawerOpen) return
    const inside = this.pane.contains(document.activeElement)
    this._setDrawer(false)
    if (inside) this.rail.toggleButton?.focus()
  }

  _setDrawer(open) {
    this.workarea.dataset.drawer = open ? 'open' : 'closed'
    // Out of sight is out of reach: no Tab stop or screen reader in a closed drawer.
    this.pane.inert = !open
    this._save({ drawer: open })
    this._drawRail()
  }

  _drawRail() {
    if (!this.isOpen || !this.tutorial.pack) return
    if (this.guided) {
      const item = this.tutorial.objective
      if (item?.type !== 'journey') return
      const playing = this.journey.item === item && this.journey.running
      const progress = playing ? [...this.journey.done] : this.tutorial.journeyProgress || []
      return this.rail.renderGuided({
        pack: this.tutorial.pack,
        mission: this.tutorial.place.mission,
        chapters: item.chapters,
        states: chapterStates(item, progress, this.tutorial.mode),
        current: playing && this.journey.index >= 0 ? this.journey.chapter : -1,
      })
    }
    this.rail.render({ pack: this.tutorial.pack, place: this.tutorial.place, finished: this.tutorial.finished, open: this.drawerOpen })
  }

  /** The student's program changed. */
  programChanged() {
    this.watcher.programChanged()
    this.journey.watcher.programChanged()
  }

  /** The student clicked a part of the simulated board (docs/mission-packs.md, `pick`). */
  pick(part) {
    this.watcher.pick(part)
    this.journey.watcher.pick(part)
  }

  /** Something the student did that a goal can ask for (docs/mission-packs.md, `event`). */
  event(name, detail) {
    this.watcher.event(name, detail)
    this.journey.watcher.event(name, detail)
  }

  /** Watch the objective on show, if one is, starting from the goals met before. */
  async _watch() {
    const pack = this.tutorial.pack
    const objective = this.isOpen && this.tutorial.objective
    this.watcher.stop()
    this.watching = null
    this.onTrek(objective?.trek ?? null)
    if (this.journey.running && this.journey.item !== objective) this.journey.stop()
    if (objective?.type === 'journey') {
      this.tutorial.journeyProgress = await this.library.goals(pack.id, objective.id)
      if (this.tutorial.objective === objective) this.tutorial.refresh()
      return
    }
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

  /**
   * The packs that come with the app, from learn/packs/index.json:
   * [{ id, file, title, brief, board }], or [] when it cannot be read.
   */
  async builtins() {
    try {
      const res = await fetch(new URL('learn/packs/index.json', document.baseURI))
      const list = res.ok ? await res.json() : []
      return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && typeof p.file === 'string' && !/[/\\]/.test(p.file)).map((p) => named(p)) : []
    } catch {
      return []
    }
  }

  /**
   * Open a pack that comes with the app: kept afresh from the site (an
   * update replaces the copy kept before; progress and a second file opened
   * for it stay), then opened where the student left it. Offline, the copy
   * kept before opens.
   */
  async openBuiltin(entry) {
    try {
      const res = await fetch(new URL(`learn/packs/${entry.file}`, document.baseURI))
      if (!res.ok) throw new Error(`${res.status}`)
      await this.library.add(await res.text())
    } catch (err) {
      console.warn(`learn: ${entry.file}`, err)
      if (!(await this.library.get(entry.id).catch(() => null))) {
        toast({ kind: 'error', title: t('learn.unreachable', { title: entry.title }) })
        return
      }
    }
    await this.open(entry.id)
  }

  /** Reopen the pack that was open before the page loaded, if any, its drawer out or away as it was. */
  async restore() {
    const saved = this._saved()
    if (saved.id) await this.open(saved.id, { quiet: true, drawer: saved.drawer !== false })
    // A journey under way when the page went: its coach comes back at the step the student was on (a guided pack's already has).
    if (saved.id && saved.journey && !this.guided && this.tutorial.objective?.type === 'journey') this._startJourney(null)
  }

  /** Open a kept pack where the student left it, with the drawer out unless `drawer` is false. */
  async open(id, { quiet = false, drawer = true } = {}) {
    const pack = await this.library.get(id).catch(() => null)
    if (!pack) {
      if (!quiet) toast({ kind: 'error', title: t('learn.gone') })
      this._save({ id: null })
      return
    }
    await loadMarkdown()
    this.tutorial.finished = await this.library.finished(pack)
    const place = await this.library.place(id)
    this.journey.stop()
    this.guided = isGuided(pack)
    this.tutorial.show(pack, place)
    this._save({ id })
    this._setOpen(true)
    // A guided pack has no drawer: the mission controller and its coach lead, from where the student left off.
    if (this.guided) {
      this._setDrawer(false)
      return this._beginMission(place?.mission ?? null)
    }
    this._setDrawer(drawer)
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
      console.warn(`${file.name}: not a pack ${BRAND.name} can open\n${problems.join('\n')}`)
      toast({ kind: 'error', title: t('learn.badPack', { name: file.name }), detail: problems.slice(0, 3).join('\n') })
      return
    }
    await this.open(pack.id)
    toast({ kind: 'info', title: t('learn.opened', { title: pack.title }) })
  }

  close() {
    this.journey.stop()
    this._save({ journey: false })
    this._save({ id: null })
    this._setOpen(false)
    this.guided = false
    this._watch()
  }

  /** 'blocks' or 'python': the tutorial shows that mode's text. A change is the `switched` event. */
  setMode(mode) {
    if (this.tutorial.mode !== mode) this.event('switched')
    this.tutorial.setMode(mode)
    this.journey.setMode(mode)
  }

  get isOpen() {
    return !this.pane.hidden
  }

  /** The rail's width, in pixels, while a pack is open: the drawer lies over the side and takes none. */
  get width() {
    return this.isOpen ? this.railEl.getBoundingClientRect().width : 0
  }

  _setOpen(open) {
    this.pane.hidden = !open
    this.railEl.hidden = !open
    this.workarea.dataset.learn = open ? 'open' : 'closed'
    this.workarea.dataset.guided = String(open && this.guided)
    if (!open) delete this.workarea.dataset.drawer
    this.onResize()
    // A guided pack has no drawer to close: the Learn button is the way out.
    this.onOpen(open && this.guided)
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
