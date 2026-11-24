/**
 * The goals HUD: the objective on show and its goals, at the lower left of
 * the simulator's view, each ticked as it is met (CodeSpace's goals HUD).
 * Folded, it is the objective's name and a box per goal, each goal's words
 * in its tooltip; open, the goals in full: open where the view has room for
 * it, folded where it is short, and not there at all where the view is
 * shorter still (a phone, with the coach up). The student's choice is kept.
 */
import { t } from '../i18n/index.js'
import { esc } from './esc.js'

const OPEN = 'opencodebot.goalsHud.v1' // 'open' or 'closed', once the student chose
const ROOMY = 300 // px: a view this tall has room for the goals in full
const SHORT = 160 // px: a view shorter than this has no room for the HUD

export class GoalsHud {
  /** `host()`: the simulator's stage, while it is on the page (null when not). */
  constructor(host) {
    this.host = host
    this.el = document.createElement('section')
    this.el.className = 'goals-hud'
    this.el.setAttribute('aria-label', t('hud.label'))
    this.el.hidden = true
    this.el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-hud="toggle"]')) return
      this.choice = !this.open
      try {
        localStorage.setItem(OPEN, this.choice ? 'open' : 'closed')
      } catch {
        // kept for this visit only
      }
      this._draw()
    })
    try {
      const kept = localStorage.getItem(OPEN)
      this.choice = kept ? kept === 'open' : null
    } catch {
      this.choice = null
    }
    this.shown = null
  }

  /**
   * Show an objective: `{ n, title, goals: [{ html, text, done, here }] }`,
   * `n` its number, `html` a goal's words, `text` the same as plain text (the
   * tooltip), `here` the one being worked on. Null takes the HUD away.
   */
  show(objective) {
    this.shown = objective?.goals?.length ? objective : null
    this._draw()
  }

  _draw() {
    const host = this.host()
    if (host && this.el.parentElement !== host) {
      host.append(this.el)
      // Folded, open or gone with the view's height, as the side is resized.
      this.resized?.disconnect()
      this.resized = new ResizeObserver(() => this.shown && this._draw())
      this.resized.observe(host)
    }
    const o = this.shown
    // A view too short to show the robot beside it (a phone's, with the coach up): no HUD.
    this.el.hidden = !o || !host || host.clientHeight < SHORT
    if (this.el.hidden) return
    this.open = this.choice ?? host.clientHeight >= ROOMY
    const done = o.goals.filter((g) => g.done).length
    const toggle = esc(t(this.open ? 'hud.fold' : 'hud.unfold'))
    const box = (g) => `<span class="goals-hud-box" data-done="${!!g.done}" aria-hidden="true">${g.done ? '✓' : ''}</span>`
    const goals = this.open
      ? `<ol class="goals-hud-list">${o.goals.map((g) => `<li data-done="${!!g.done}"${g.here ? ' aria-current="step"' : ''}>${box(g)}<span class="goals-hud-words">${g.html}</span></li>`).join('')}</ol>`
      : `<ol class="goals-hud-boxes">${o.goals.map((g) => `<li title="${esc(g.text)}"${g.here ? ' aria-current="step"' : ''}>${box(g)}<span class="sr-only">${esc(g.text)}${g.done ? `, ${esc(t('hud.met'))}` : ''}</span></li>`).join('')}</ol>`
    this.el.dataset.open = String(this.open)
    this.el.innerHTML = `${goals}
      <div class="goals-hud-head">
        <button type="button" class="goals-hud-toggle" data-hud="toggle" aria-expanded="${this.open}" title="${toggle}" aria-label="${toggle}"><span aria-hidden="true">${this.open ? '▾' : '☰'}</span></button>
        <span class="goals-hud-title"><em>${esc(t('hud.objective', { n: o.n }))}</em> ${esc(o.title)}</span>
        <span class="goals-hud-count">${esc(t('hud.count', { done, count: o.goals.length }))}</span>
      </div>`
  }
}
