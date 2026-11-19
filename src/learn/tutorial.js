/**
 * The tutorial pane: a pack's overview and missions, then a mission one step
 * at a time (its introduction, its objectives and quizzes, its finish), with
 * Back and Next. It shows the text for the mode the student is in, and, in
 * blocks, says when an objective is taught in Python. It fires `place` when
 * the student moves, `shown` when it draws a place or its goals again,
 * `close` when they close it, and `python` when they ask to switch to Python.
 *
 * A place is null (the pack's overview) or { mission, step }: step -1 is the
 * mission's introduction, 0 to n-1 its flow, n its finish.
 */
import { t } from '../i18n/index.js'
import { esc } from './esc.js'

// Markdown (markdown-it) comes in when a pack first opens, not with the page.
let renderMarkdown = null
let markdownLoading = null
/** Load the Markdown renderer; resolves either way (without it, text shows plain). */
export function loadMarkdown() {
  if (renderMarkdown) return Promise.resolve()
  // No module: it was gone after a deploy and the page is reloading (src/ui/new-build.js).
  markdownLoading ??= import('./markdown.js')
    .then((m) => { renderMarkdown = m?.renderMarkdown ?? null })
    .catch((err) => console.warn('Markdown did not load; mission text shows plain.', err))
    .then(() => { if (!renderMarkdown) markdownLoading = null }) // the next pack opened tries again
  return markdownLoading
}

export class Tutorial extends EventTarget {
  /** `offersBlocks(objective, board)`: whether the objective is taught in blocks. */
  constructor(root, { offersBlocks = () => true } = {}) {
    super()
    this.root = root
    this.offersBlocks = offersBlocks
    this.pack = null
    this.place = null
    this.mode = 'blocks'
    this.quiz = new Map() // question id: { order, picked: Set }, while the pack is open
    this.done = [] // the open objective's goals: met?
    this.finished = new Set() // the pack's objectives with every goal met, by id
    root.innerHTML = `
      <div class="learn-bar">
        <button type="button" class="learn-up btn-plain" data-learn="up"></button>
        <h2 class="learn-pack-title" id="learn-pack-title"></h2>
        <button type="button" class="learn-close btn-plain" data-learn="close" aria-label="${esc(t('learn.close'))}" title="${esc(t('learn.close'))}">✕</button>
      </div>
      <div class="learn-body" tabindex="-1" aria-labelledby="learn-pack-title"></div>
      <div class="learn-nav">
        <button type="button" class="btn btn-small btn-quiet" data-learn="back"></button>
        <span class="learn-count" aria-live="polite"></span>
        <button type="button" class="btn btn-small" data-learn="next"></button>
      </div>`
    root.addEventListener('click', (e) => this._click(e))
  }

  /** Show a pack at a place (one it no longer has falls back to the overview). */
  show(pack, place) {
    if (this.pack?.id !== pack.id) this.quiz.clear()
    this.pack = pack
    this.place = this._valid(place) ? place : null
    this.done = []
    this._render()
  }

  /** The objective on show, or null. */
  get objective() {
    const item = this.place && this.pack.missions[this.place.mission].flow[this.place.step]
    return item?.type === 'objective' ? item : null
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    if (this.pack) this._render()
  }

  _valid(place) {
    const m = place && this.pack.missions[place.mission]
    return !!m && Number.isInteger(place.step) && place.step >= -1 && place.step <= m.flow.length
  }

  /** Go to a place, as Back and Next do. */
  go(place) {
    if (this._valid(place)) this._go(place)
  }

  _go(place) {
    this.place = place
    this.done = []
    this._render()
    this.root.querySelector('.learn-body').scrollTop = 0
    this.root.querySelector('.learn-body').focus({ preventScroll: true })
    this.dispatchEvent(new CustomEvent('place', { detail: place }))
  }

  _md(text) {
    if (text && !renderMarkdown) return text.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('')
    return text ? renderMarkdown(text, { mode: this.mode, assets: this.pack.assets, label: (name, title) => t(`learn.section.${name}`, { name: title }) }) : ''
  }

  _click(e) {
    const el = e.target.closest('[data-learn], [data-mission], [data-answer]')
    if (!el || !this.root.contains(el)) return
    if (el.dataset.mission !== undefined) return this._go({ mission: Number(el.dataset.mission), step: -1 })
    if (el.dataset.answer !== undefined) return this._answer(el.closest('[data-question]').dataset.question, Number(el.dataset.answer))
    const p = this.place
    switch (el.dataset.learn) {
      case 'close':
        return this.dispatchEvent(new Event('close'))
      case 'python':
        return this.dispatchEvent(new Event('python'))
      case 'up':
        return this._go(null)
      case 'back':
        return this._go(p.step > -1 ? { ...p, step: p.step - 1 } : null)
      case 'next': {
        const flow = this.pack.missions[p.mission].flow
        if (p.step < flow.length) return this._go({ ...p, step: p.step + 1 })
        return this._go(p.mission + 1 < this.pack.missions.length ? { mission: p.mission + 1, step: -1 } : null)
      }
    }
  }

  _render() {
    const { pack, place } = this
    const $ = (sel) => this.root.querySelector(sel)
    $('.learn-pack-title').textContent = pack.title
    $('.learn-up').hidden = !place
    $('.learn-up').textContent = `‹ ${t('learn.missions')}`
    $('.learn-nav').hidden = !place
    $('.learn-body').innerHTML = place ? this._missionHtml(place) : this._packHtml()
    this.dispatchEvent(new Event('shown'))
    if (!place) return
    const mission = pack.missions[place.mission]
    const n = mission.flow.length
    $('[data-learn="back"]').textContent = `‹ ${t('learn.back')}`
    $('[data-learn="next"]').textContent =
      place.step < n ? `${t(place.step === -1 ? 'learn.start' : 'learn.next')} ›` : place.mission + 1 < pack.missions.length ? `${t('learn.nextMission')} ›` : t('learn.allMissions')
    $('.learn-count').textContent = place.step >= 0 && place.step < n ? t('learn.stepOf', { step: place.step + 1, count: n }) : ''
  }

  _packHtml() {
    const { pack } = this
    const missions = pack.missions
      .map((m, i) => {
        const objectives = m.flow.filter((s) => s.type === 'objective')
        const done = objectives.length > 0 && objectives.every((s) => this.finished.has(s.id))
        return `<li><button type="button" class="learn-mission" data-mission="${i}" data-done="${done}"><span class="ex-num" aria-hidden="true">${done ? '✓' : i + 1}</span><span class="ex-text"><span class="ex-title">${esc(m.title)}${done ? `<span class="sr-only"> ${esc(t('learn.missionFinished'))}</span>` : ''}</span>${m.brief ? `<span class="ex-goal">${esc(m.brief)}</span>` : ''}</span></button></li>`
      })
      .join('')
    return `<div class="learn-md">${this._md(pack.overview) || `<p>${esc(pack.brief)}</p>`}</div>
      <h3 class="learn-head">${esc(t('learn.missions'))}</h3>
      <ol class="ex-list" aria-label="${esc(t('learn.missions'))}">${missions}</ol>
      ${pack.licence ? `<p class="learn-licence">${esc(pack.licence)}</p>` : ''}`
  }

  _missionHtml({ mission: mi, step }) {
    const mission = this.pack.missions[mi]
    if (step === -1) return `<p class="learn-kicker">${esc(t('learn.missionN', { n: mi + 1 }))}</p><h3 class="learn-title">${esc(mission.title)}</h3><div class="learn-md">${this._md(mission.overview || mission.brief)}</div>`
    if (step === mission.flow.length) return `<h3 class="learn-title">${esc(t('learn.missionDone', { title: mission.title }))}</h3><div class="learn-md">${this._md(mission.complete)}</div>`
    const item = mission.flow[step]
    return item.type === 'quiz' ? this._quizHtml(item) : this._objectiveHtml(item)
  }

  _objectiveHtml(o) {
    const hints = (o.hints || []).map((h, i) => `<details class="learn-hint"><summary>${esc(t('learn.hint', { n: i + 1 }))}</summary><div class="learn-md">${this._md(h)}</div></details>`).join('')
    return `<h3 class="learn-title">${esc(o.title)}</h3>
      ${this._pythonHtml(o)}
      <div class="learn-md">${this._md(o.instructions)}</div>
      <h4 class="learn-head">${esc(t('learn.goals'))}</h4>
      <div class="learn-goals-wrap" aria-live="polite">${this._goalsHtml(o)}</div>
      ${hints}`
  }

  /** In blocks, a word that this objective is taught in Python, with the switch. */
  _pythonHtml(o) {
    if (this.mode !== 'blocks' || this.offersBlocks(o, o.board || this.pack.board)) return ''
    return `<div class="learn-python" role="note"><p>${esc(t('learn.pythonOnly'))}</p><button type="button" class="btn btn-small" data-learn="python">${esc(t('learn.toPython'))}</button></div>`
  }

  /** The goals, each ticked once met, and the objective's cheer when they all are. */
  _goalsHtml(o) {
    const goals = o.goals
      .map((g, i) => {
        const done = !!this.done[i]
        return `<li data-met="${done}"><span class="learn-box" aria-hidden="true">${done ? '✓' : ''}</span><span class="sr-only">${esc(t(done ? 'learn.goalMet' : 'learn.goalOpen'))}</span><div class="learn-md">${this._md(g.md)}</div></li>`
      })
      .join('')
    const all = o.goals.length > 0 && o.goals.every((_, i) => this.done[i])
    return `<ul class="learn-goals">${goals}</ul>${all ? `<div class="learn-complete learn-md">${this._md(o.complete) || `<p>${esc(t('learn.objectiveDone'))}</p>`}</div>` : ''}`
  }

  /**
   * Which of the open objective's goals are met, and which objectives of the
   * pack are finished. Only the goals are drawn again, so open hints stay open.
   */
  setDone(done, finished = this.finished) {
    this.done = done
    this.finished = finished
    const wrap = this.root.querySelector('.learn-goals-wrap')
    if (wrap && this.objective) wrap.innerHTML = this._goalsHtml(this.objective)
    this.dispatchEvent(new Event('shown'))
  }

  _quizHtml(q) {
    const questions = q.questions
      .map((question, qi) => {
        const state = this._quizState(question)
        const answers = state.order
          .map((ai) => {
            const a = question.answers[ai]
            const picked = state.picked.has(ai)
            const verdict = picked ? (a.correct ? 'right' : 'wrong') : ''
            return `<li><button type="button" class="learn-answer" data-answer="${ai}" data-verdict="${verdict}"${picked && !a.correct ? ' disabled' : ''}${picked ? ' aria-pressed="true"' : ''}>${verdict ? `<span class="sr-only">${esc(t(`learn.${verdict}`))}</span>` : ''}<div class="learn-md">${this._md(a.a)}</div></button></li>`
          })
          .join('')
        return `<li class="learn-question" data-question="${esc(question.id)}"><div class="learn-md">${this._md(question.q)}</div><ul class="learn-answers" aria-label="${esc(t('learn.answers', { n: qi + 1 }))}">${answers}</ul></li>`
      })
      .join('')
    return `<h3 class="learn-title">${esc(q.title)}</h3><div class="learn-md">${this._md(q.overview)}</div><ol class="learn-quiz">${questions}</ol>`
  }

  _quizState(question) {
    if (!this.quiz.has(question.id)) {
      const order = question.answers.map((_, i) => i)
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      this.quiz.set(question.id, { order, picked: new Set() })
    }
    return this.quiz.get(question.id)
  }

  _answer(questionId, answer) {
    this.quiz.get(questionId)?.picked.add(answer)
    const body = this.root.querySelector('.learn-body')
    const top = body.scrollTop
    this._render()
    body.scrollTop = top
    this.root.querySelector(`[data-question="${CSS.escape(questionId)}"] [data-answer="${answer}"]`)?.focus()
  }
}
