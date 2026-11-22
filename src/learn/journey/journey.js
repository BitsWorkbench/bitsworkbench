/**
 * Plays a journey (docs/mission-packs.md, "Journeys"): its steps one at a
 * time, each pointed at, checked by the same checks as goals, and answered;
 * the student's place kept by step id, so leaving and coming back resumes.
 *
 * A journey is played in one mode, blocks or Python, chosen when it starts.
 * The program is the same in both, so switching mid-journey loses nothing,
 * but each step's words and places belong to its mode: the coach pauses until
 * the student switches back.
 */
import { t } from '../../i18n/index.js'
import { esc } from '../esc.js'
import { Coach } from './coach.js'

const FINISHED = '$done' // in a journey's progress: the finish was reached

export class Journey extends EventTarget {
  /**
   * `places`: a Places; `md(text, mode)`: Markdown to HTML; `watcher`: a
   * GoalWatcher of its own; `library`: where progress is kept; `side()`:
   * { sim, terminal } boxes on the page (either may be null);
   * `startOver(python)`: put a chapter's program in place of the student's,
   * theirs kept (it may ask them first); true once done, false if they kept working.
   * Fires `finished` when the student leaves the finish card, `exit` when they stop.
   */
  constructor({ places, md, watcher, library, side, startOver, effects = null }) {
    super()
    this.places = places
    this.md = md
    this.watcher = watcher
    this.library = library
    this.side = side
    this.startOver = startOver
    this.effects = effects
    this.coach = null
    this.running = false
    watcher.addEventListener('goals', (e) => e.detail[0] && this._met())
  }

  /**
   * Begin, or carry on, `item` of `pack` in `mode`; `chapter` (an index)
   * starts that chapter over. False when the student, asked whether to
   * replace their program with the chapter's, kept working: nothing changed.
   */
  async start(pack, item, mode, { chapter = null } = {}) {
    const code = chapter !== null && item.chapters[chapter]?.code
    if (code && !(await this.startOver(code))) return false
    this.stop()
    this.pack = pack
    this.item = item
    this.mode = mode
    this.paused = false
    this.coach = new Coach({ md: (text) => this.md(text, this.mode) })
    this.coach.addEventListener('action', (e) => this._action(e.detail))
    this.steps = item.chapters.flatMap((c, ci) => c.steps.filter((s) => !s.mode || s.mode === mode).map((s) => ({ ...s, chapter: ci })))
    this.done = new Set(await this.library.goals(pack.id, item.id))
    this.running = true
    if (chapter !== null) {
      const first = this.steps.findIndex((s) => s.chapter === chapter)
      this.steps.filter((s) => s.chapter >= chapter).forEach((s) => this.done.delete(s.id))
      this.done.delete(FINISHED)
      await this._save()
      this._go(first)
      return true
    }
    const next = this.steps.findIndex((s) => !this.done.has(s.id))
    if (next === -1) await this._finish()
    else if (next === 0) this._opening()
    else this._go(next)
    return true
  }

  /** Put the coach away; progress stays. */
  stop() {
    this.watcher.stop()
    this.effects?.clear()
    this.coach?.dispose()
    this.coach = null
    this.running = false
  }

  /** The student switched mode: pause the journey until they switch back. */
  setMode(mode) {
    if (!this.running) return
    if (mode !== this.mode && !this.paused) {
      this.paused = true
      this.watcher.stop()
      this.effects?.clear()
      const other = t(mode === 'python' ? 'journey.modeBlocks' : 'journey.modePython')
      this.coach.centre(`<h2 tabindex="-1">${esc(t('journey.pausedTitle'))}</h2><p>${esc(t('journey.paused', { mode: other }))}</p>
        <div class="journey-row"><button type="button" class="btn btn-small" data-journey="switch-back">${esc(t('journey.switchBack', { mode: other }))}</button>
        <button type="button" class="btn-plain journey-link" data-journey="exit">${esc(t('journey.exit'))}</button></div>`, this.side().sim)
    } else if (mode === this.mode && this.paused) {
      this.paused = false
      this._go(this.index, { fresh: false })
    }
  }

  // ------------------------------------------------------------ steps

  _opening() {
    this.index = -1
    this._strip()
    this.coach.centre(`<h2 tabindex="-1">${esc(this.item.title)}</h2>${this.md(this.item.promise, this.mode)}
      <div class="journey-row"><button type="button" class="btn" data-journey="begin">${esc(t('journey.begin'))}</button></div>`, this.side().sim)
    this.effects?.opening?.()
  }

  _go(i, { fresh = true } = {}) {
    this.index = i
    this.hint = false
    this.picked = new Set()
    this.effects?.clear()
    this.coach.card(null)
    const s = this.steps[i]
    if (!s) return this._finish()
    this._strip()
    if (s.ask) return this._ask()
    this.coach.step({
      index: i,
      count: this.steps.length,
      html: this.md(s.say, this.mode),
      locate: () => this._locate(s),
      hints: s.hints?.length ?? 0,
      skippable: !!s.skippable,
      showMe: !!this.effects?.hasHelp?.(s),
      fresh,
    })
    if (fresh) this.coach.announce(`${t('journey.stepOf', { n: i + 1, m: this.steps.length })}. ${this._plain(s.say)}`)
    // A block in a category: open it, so the ring lands on the block itself.
    if (s.palette && !this.places.resolve(s.point)) this.places.openPalette(s.palette)
    this.effects?.waiting?.(s)
    this.watcher.start([{ md: '', check: s.do }])
  }

  /** Where a step points now: its place; a palette block's category while that is closed. */
  _locate(s) {
    const found = this.places.resolve(s.point)
    if (found || !s.palette) return found
    return this.places.resolve(`palette:${s.palette}`)
  }

  _ask() {
    const s = this.steps[this.index]
    this.coach.ask({
      index: this.index,
      count: this.steps.length,
      html: this.md(s.ask, this.mode),
      answers: s.answers.map((a) => ({ ...a, html: this.md(a.a, this.mode) })),
      picked: this.picked,
      over: this.side().sim,
      cheer: s.cheer && this.md(s.cheer, this.mode),
    })
  }

  async _met() {
    const s = this.steps[this.index]
    if (!s || this.paused) return
    this.watcher.stop()
    this.done.add(s.id)
    await this._save()
    this._strip()
    this.coach.met({ html: s.cheer && this.md(s.cheer, this.mode) })
    this.coach.announce(`${t('journey.done')}. ${this._plain(s.cheer || '')}`)
    this.effects?.met?.(s)
    if (s.show) this.coach.card(this._card(s.show), this.side().terminal)
  }

  _card(show) {
    const caption = this.md(show.caption, this.mode)
    if (show.card === 'picture' && show.asset) return `<div class="journey-card-row"><img src="${esc(this.pack.assets?.[show.asset] || '')}" alt=""><div>${caption}</div></div>`
    if (show.card === 'compare') return `<pre class="journey-code">${esc(this.effects?.programText?.() ?? '')}</pre>${caption}`
    return caption
  }

  async _finish() {
    this.index = this.steps.length
    this.watcher.stop()
    this.done.add(FINISHED)
    await this._save()
    this._strip()
    this.coach.centre(`<h2 tabindex="-1">🎉 ${esc(t('journey.finished'))}</h2>${this.md(this.item.complete || '', this.mode)}
      <div class="journey-row"><button type="button" class="btn" data-journey="finish">${esc(t('journey.next'))}</button></div>`, this.side().sim)
    this.coach.announce(t('journey.finished'))
    this.effects?.finish?.()
    this.dispatchEvent(new CustomEvent('progress'))
  }

  _strip() {
    const done = new Set(this.steps.map((s, i) => (this.done.has(s.id) ? i : -1)).filter((i) => i >= 0))
    this.coach.strip({ title: this.item.title, index: this.index, count: this.steps.length, done, over: this.side().sim })
  }

  async _save() {
    await this.library.setGoals(this.pack.id, this.item.id, [...this.done])
    this.dispatchEvent(new CustomEvent('progress'))
  }

  _plain(md) {
    const div = document.createElement('div')
    div.innerHTML = this.md(md, this.mode)
    return div.textContent.trim()
  }

  async _action({ action, value }) {
    const s = this.steps[this.index]
    switch (action) {
      case 'begin':
        return this._go(0)
      case 'next':
        return this._go(this.index + 1)
      case 'skip':
        this.done.add(s.id)
        await this._save()
        return this._go(this.index + 1)
      case 'hint':
        this.hint = true
        return this.coach.step({ index: this.index, count: this.steps.length, html: this.md(s.say, this.mode), locate: () => this._locate(s), hints: s.hints.length, hintShown: this.md(s.hints[0], this.mode), skippable: !!s.skippable, showMe: !!this.effects?.hasHelp?.(s), fresh: false })
      case 'show-me':
        return this.effects?.waiting?.(s, { again: true })
      case 'answer': {
        const i = Number(value)
        this.picked.add(i)
        if (s.answers[i]?.correct) {
          this.done.add(s.id)
          await this._save()
          this._strip()
        }
        return this._ask()
      }
      case 'fold':
        return this.coach.fold(true)
      case 'unfold':
        return this.coach.fold(false)
      case 'switch-back':
        return this.dispatchEvent(new CustomEvent('switch-mode', { detail: this.mode }))
      case 'exit':
        this.stop()
        return this.dispatchEvent(new CustomEvent('exit'))
      case 'finish':
        this.stop()
        return this.dispatchEvent(new CustomEvent('finished'))
    }
  }
}

/** Is a journey's progress (its kept goals) finished? */
export const journeyDone = (progress) => Array.isArray(progress) && progress.includes(FINISHED)
