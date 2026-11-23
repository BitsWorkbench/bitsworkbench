/**
 * The journey's coach on screen: a gold ring on the place a step points at, a
 * moment's dimming around it, a bubble beside it with the step's words, a
 * strip of dots over the simulator for where the student is, cards beside the
 * simulator to explain, and the opening and finishing cards.
 *
 * It lies over the app in a layer of its own; only its bubble and cards take
 * clicks, so the student works the real app underneath. Places move (the
 * palette scrolls, a block is dragged, the window resizes), so while a step is
 * up the coach looks again a few times a second.
 *
 * Keyboard and screen readers: the bubble is a labelled region whose words are
 * announced when a step opens and when it is met; when it is met, focus moves
 * to Next. Nothing moves on its own; Escape folds the bubble down to the strip.
 */
import { t } from '../../i18n/index.js'
import { esc } from '../esc.js'

const FOLLOW_MS = 250

export class Coach extends EventTarget {
  /** `md(text)`: Markdown to HTML, in the student's mode. */
  constructor({ md }) {
    super()
    this.md = md
    this.layer = document.createElement('div')
    this.layer.className = 'journey-layer'
    this.layer.innerHTML = `<div class="journey-ring" aria-hidden="true"></div>
      <div class="journey-strip" role="status"></div>
      <section class="journey-bubble" role="region" aria-label="${esc(t('journey.guide'))}" hidden><span class="journey-arrow" aria-hidden="true"></span><div class="journey-body"></div></section>
      <aside class="journey-card" hidden></aside>
      <section class="journey-centre" role="dialog" aria-modal="false" hidden></section>
      <div class="journey-live sr-only" aria-live="polite"></div>`
    document.body.append(this.layer)
    this.$ = (s) => this.layer.querySelector(s)
    this.layer.addEventListener('click', (e) => {
      const b = e.target.closest('[data-journey]')
      if (b) this.dispatchEvent(new CustomEvent('action', { detail: { action: b.dataset.journey, value: b.dataset.value } }))
    })
    this.layer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.$('.journey-bubble').contains(e.target)) {
        e.preventDefault()
        this.dispatchEvent(new CustomEvent('action', { detail: { action: 'fold' } }))
      }
    })
    addEventListener('resize', () => this.follow())
  }

  get reduced() {
    return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  announce(text) {
    const live = this.$('.journey-live')
    live.textContent = ''
    setTimeout(() => (live.textContent = text), 60)
  }

  /** The strip over the simulator: the journey's title, a dot per step, the count. */
  strip({ title, index, count, done, over }) {
    const s = this.$('.journey-strip')
    s.hidden = !over
    if (!over) return
    Object.assign(s.style, { left: `${over.x}px`, top: `${over.y}px`, width: `${over.w}px` })
    const dots = Array.from({ length: count }, (_, i) => `<i class="${done.has(i) ? 'done' : i === index ? 'here' : ''}"></i>`).join('')
    s.innerHTML = `<span class="journey-strip-title">${esc(title)}</span><span class="journey-dots" aria-hidden="true">${dots}</span><span>${index >= 0 && index < count ? esc(t('journey.stepOf', { n: index + 1, m: count })) : ''}</span>
      <button type="button" class="journey-strip-open" data-journey="unfold">${esc(t('journey.show'))}</button>`
    s.querySelector('.journey-strip-open').hidden = !this.folded
  }

  /**
   * A step: its words in the bubble beside `locate()`'s place (a function, as
   * the place moves), the ring on it, and buttons for help.
   */
  step({ index, count, html, locate, hints = 0, hintShown = null, skippable = false, showMe = false, fresh = true, doneBefore = false }) {
    this.locate = locate
    this.lastBox = null
    this.good = false
    this.folded = false
    const b = this.$('.journey-bubble')
    b.hidden = false
    b.classList.remove('good')
    b.classList.toggle('pop', fresh && !this.reduced)
    b.querySelector('.journey-body').innerHTML = `<p class="journey-n">${esc(t('journey.stepOf', { n: index + 1, m: count }))}</p>
      <div class="journey-say">${html}</div>
      ${hintShown ? `<div class="journey-hint">💡 ${hintShown}</div>` : ''}
      <div class="journey-row">
        ${showMe ? `<button type="button" class="btn-plain journey-link" data-journey="show-me">${esc(t('journey.showMe'))}</button>` : ''}
        ${hints && !hintShown ? `<button type="button" class="btn-plain journey-link" data-journey="hint">${esc(t('journey.hint'))}</button>` : ''}
        ${skippable && !doneBefore ? `<button type="button" class="btn-plain journey-link" data-journey="skip">${esc(t('journey.skip'))}</button>` : ''}
        ${doneBefore ? `<span class="journey-before">✓ ${esc(t('journey.doneBefore'))}</span><button type="button" class="btn btn-small journey-next" data-journey="next">${esc(t('journey.next'))}</button>` : ''}
      </div>`
    this.$('.journey-centre').hidden = true
    if (fresh) this.dim()
    this.follow()
    this._following()
  }

  /** The step is met: the bubble turns green with the cheer, and Next takes the focus. */
  met({ html }) {
    this.good = true
    const b = this.$('.journey-bubble')
    b.classList.add('good')
    b.querySelector('.journey-body').innerHTML = `<p class="journey-n">✓ ${esc(t('journey.done'))}</p>
      <div class="journey-say">${html || ''}</div>
      <div class="journey-row"><button type="button" class="btn btn-small journey-next" data-journey="next">${esc(t('journey.next'))}</button></div>`
    this.$('.journey-ring').hidden = true
    this.$('.journey-ring').classList.remove('dim')
    this.follow()
    b.querySelector('.journey-next').focus({ preventScroll: true })
  }

  /** A question in the bubble, over the simulator; `picked` maps answer to right or wrong. */
  ask({ index, count, html, answers, picked, over, cheer }) {
    this.locate = () => over && { box: { x: over.x + over.w / 2 - 1, y: over.y + 40, w: 2, h: 2 } }
    const right = answers.findIndex((a) => a.correct)
    const solved = picked.has(right)
    this.good = solved
    const b = this.$('.journey-bubble')
    b.hidden = false
    b.classList.toggle('good', solved)
    b.querySelector('.journey-body').innerHTML = `<p class="journey-n">${esc(t('journey.stepOf', { n: index + 1, m: count }))}</p>
      <div class="journey-say">${html}</div>
      <div class="journey-answers">${answers.map((a, i) => `<button type="button" data-journey="answer" data-value="${i}" ${picked.has(i) ? `data-${a.correct ? 'right' : 'wrong'}` : ''} ${solved ? 'disabled' : ''}>${a.html}</button>`).join('')}</div>
      ${!solved && [...picked].some((i) => i !== right) ? `<p class="journey-again" role="status">${esc(t('journey.wrong'))}</p>` : ''}
      ${solved ? `<div class="journey-say">${cheer || ''}</div><div class="journey-row"><button type="button" class="btn btn-small journey-next" data-journey="next">${esc(t('journey.next'))}</button></div>` : ''}`
    this.$('.journey-ring').hidden = true
    this.$('.journey-centre').hidden = true
    this.follow()
    if (solved) b.querySelector('.journey-next').focus({ preventScroll: true })
  }

  /** A card beside the simulator, over the terminal: `html`, or null to take it away. */
  card(html, under) {
    const c = this.$('.journey-card')
    c.hidden = !html || !under
    if (c.hidden) return
    c.innerHTML = html
    Object.assign(c.style, { left: `${under.x + 8}px`, top: `${under.y + 8}px`, width: `${Math.max(under.w - 16, 220)}px` })
  }

  /** The opening, the finish and the pause: a card over the simulator, with buttons. */
  centre(html, over, { focus = true } = {}) {
    this.locate = null
    this.$('.journey-bubble').hidden = true
    this.$('.journey-ring').hidden = true
    this.$('.journey-ring').classList.remove('dim')
    const c = this.$('.journey-centre')
    c.hidden = false
    c.innerHTML = html
    const w = Math.min(360, innerWidth - 24)
    c.style.width = `${w}px`
    c.style.left = `${Math.max(12, Math.min(over ? over.x + over.w / 2 - w / 2 : innerWidth / 2 - w / 2, innerWidth - w - 12))}px`
    c.style.top = `${over ? over.y + Math.min(48, over.h / 6) : 80}px`
    clearInterval(this.timer)
    if (focus) (c.querySelector('h2') || c.querySelector('button'))?.focus({ preventScroll: true })
  }

  /** Fold the bubble away (Escape): only the strip stays, with a button to bring it back. */
  fold(folded) {
    this.folded = folded
    this.$('.journey-bubble').hidden = folded
    this.$('.journey-ring').hidden = folded || this.good
    this.$('.journey-strip-open') && (this.$('.journey-strip-open').hidden = !folded)
  }

  hide() {
    clearInterval(this.timer)
    this.locate = null
    for (const s of ['.journey-bubble', '.journey-card', '.journey-centre', '.journey-strip']) this.$(s).hidden = true
    this.$('.journey-ring').hidden = true
    this.$('.journey-ring').classList.remove('dim')
  }

  /** Dim all but the place for a moment, so the eye finds it. */
  dim() {
    const d = this.$('.journey-ring')
    d.classList.add('dim')
    clearTimeout(this.dimTimer)
    this.dimTimer = setTimeout(() => d.classList.remove('dim'), this.reduced ? 2400 : 1300)
  }

  _following() {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.follow(), FOLLOW_MS)
  }

  /** Put the ring on the place and the bubble beside it, where there is room. */
  follow() {
    if (!this.locate) return
    const b = this.$('.journey-bubble')
    const ring = this.$('.journey-ring')
    let found = this.locate()
    // Never a ring on what is off the screen: the bubble waits, unanchored, for the controller to bring it back.
    const b0 = found?.box
    if (b0 && (b0.x + b0.w / 2 < 0 || b0.y + b0.h / 2 < 0 || b0.x + b0.w / 2 > innerWidth || b0.y + b0.h / 2 > innerHeight)) found = null
    // A met step's place can go (the block the student changed no longer matches): the bubble stays where it was.
    const box = found?.box ?? (this.good ? this.lastBox : null)
    if (found?.box) this.lastBox = found.box
    ring.hidden = !found?.box || this.good || this.folded
    if (box) {
      Object.assign(ring.style, { left: `${box.x - 5}px`, top: `${box.y - 5}px`, width: `${box.w + 10}px`, height: `${box.h + 10}px` })
    }
    if (b.hidden) return
    const W = Math.min(290, innerWidth - 16)
    b.style.width = `${W}px`
    const H = b.offsetHeight || 140
    const at = box || { x: innerWidth / 2, y: 70, w: 0, h: 0 }
    // A place may ask for a side (a line of code: to its right, past the line's end, so the code stays in sight).
    if (found) this.lastSide = found.side ? { side: found.side, beside: found.beside ?? found.box } : null
    const prefer = box && this.lastSide
    const by = prefer?.beside ?? at
    const sides = [
      ['below', at.x + at.w / 2 - W / 2, at.y + at.h + 14],
      ['above', at.x + at.w / 2 - W / 2, at.y - H - 14],
      ['right', by.x + by.w + 14, at.y + at.h / 2 - H / 2],
      ['left', at.x - W - 14, at.y + at.h / 2 - H / 2],
    ]
    if (prefer) sides.sort((a, b) => (b[0] === prefer.side) - (a[0] === prefer.side))
    const fits = ([, l, tp]) => l >= 6 && tp >= 6 && l + W <= innerWidth - 6 && tp + H <= innerHeight - 6
    // Clear of the card beside the simulator when it can be: the card must not cover the bubble's Next.
    const card = this.$('.journey-card')
    const c = card.hidden ? null : card.getBoundingClientRect()
    const clear = ([, l, tp]) => !c || l + W <= c.left || l >= c.right || tp + H <= c.top || tp >= c.bottom
    let [side, l, tp] = sides.find((s) => fits(s) && clear(s)) || sides.find(fits) || sides[0]
    l = Math.max(6, Math.min(l, innerWidth - W - 6))
    tp = Math.max(6, Math.min(tp, innerHeight - H - 6))
    Object.assign(b.style, { left: `${l}px`, top: `${tp}px` })
    b.dataset.side = box ? side : 'none'
    const arrow = b.querySelector('.journey-arrow')
    arrow.style.setProperty('--ax', `${Math.max(14, Math.min(at.x + at.w / 2 - l - 8, W - 30))}px`)
    arrow.style.setProperty('--ay', `${Math.max(14, Math.min(at.y + at.h / 2 - tp - 8, H - 30))}px`)
  }

  dispose() {
    clearInterval(this.timer)
    this.layer.remove()
  }
}
