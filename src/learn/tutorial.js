/**
 * The tutorial pane: a pack's overview and missions, then a mission one step
 * at a time (its introduction, its objectives and quizzes, its finish), with
 * Back and Next. It shows the text for the mode the student is in. It fires
 * `place` when the student moves, and `close` when they close it.
 *
 * A place is null (the pack's overview) or { mission, step }: step -1 is the
 * mission's introduction, 0 to n-1 its flow, n its finish.
 */
import { t } from '../i18n/index.js'
import { renderMarkdown, esc } from './markdown.js'

export class Tutorial extends EventTarget {
  constructor(root) {
    super()
    this.root = root
    this.pack = null
    this.place = null
    this.mode = 'blocks'
    this.quiz = new Map() // question id: { order, picked: Set }, while the pack is open
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
    this._render()
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

  _go(place) {
    this.place = place
    this._render()
    this.root.querySelector('.learn-body').scrollTop = 0
    this.root.querySelector('.learn-body').focus({ preventScroll: true })
    this.dispatchEvent(new CustomEvent('place', { detail: place }))
  }

  _md(text) {
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
      .map(
        (m, i) =>
          `<li><button type="button" class="learn-mission" data-mission="${i}"><span class="ex-num" aria-hidden="true">${i + 1}</span><span class="ex-text"><span class="ex-title">${esc(m.title)}</span>${m.brief ? `<span class="ex-goal">${esc(m.brief)}</span>` : ''}</span></button></li>`,
      )
      .join('')
    return `<div class="learn-md">${this._md(pack.overview) || `<p>${esc(pack.brief)}</p>`}</div>
      <h3 class="learn-head">${esc(t('learn.missions'))}</h3>
      <ol class="ex-list" aria-label="${esc(t('learn.missions'))}">${missions}</ol>`
  }

  _missionHtml({ mission: mi, step }) {
    const mission = this.pack.missions[mi]
    if (step === -1) return `<p class="learn-kicker">${esc(t('learn.missionN', { n: mi + 1 }))}</p><h3 class="learn-title">${esc(mission.title)}</h3><div class="learn-md">${this._md(mission.overview || mission.brief)}</div>`
    if (step === mission.flow.length) return `<h3 class="learn-title">${esc(t('learn.missionDone', { title: mission.title }))}</h3><div class="learn-md">${this._md(mission.complete)}</div>`
    const item = mission.flow[step]
    return item.type === 'quiz' ? this._quizHtml(item) : this._objectiveHtml(item)
  }

  _objectiveHtml(o) {
    const goals = o.goals.map((g) => `<li><span class="learn-box" aria-hidden="true"></span><div class="learn-md">${this._md(g.md)}</div></li>`).join('')
    const hints = (o.hints || []).map((h, i) => `<details class="learn-hint"><summary>${esc(t('learn.hint', { n: i + 1 }))}</summary><div class="learn-md">${this._md(h)}</div></details>`).join('')
    return `<h3 class="learn-title">${esc(o.title)}</h3>
      <div class="learn-md">${this._md(o.instructions)}</div>
      <h4 class="learn-head">${esc(t('learn.goals'))}</h4>
      <ul class="learn-goals">${goals}</ul>
      ${hints}`
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
