/**
 * The mission rail: a narrow strip at the right edge while a mission pack is
 * open. It opens and closes the mission drawer, and shows where the student
 * is without opening it: the mission, one button per step (an objective
 * turns green once its goals are all met), and the step on show.
 *
 * It fires `toggle` to open or close the drawer, and `go` with a place
 * (tutorial.js) when the student picks a step.
 */
import { t } from '../i18n/index.js'
import { esc } from './esc.js'

export class Rail extends EventTarget {
  /** `root`, the rail's element; `controls`, the id of the drawer it opens. */
  constructor(root, { controls }) {
    super()
    this.root = root
    this.controls = controls
    this.place = null
    this.open = false
    root.addEventListener('click', (e) => this._click(e))
  }

  /** Draw the rail for a pack at a place, `finished` its finished objectives by id, `open` the drawer's state. */
  render({ pack, place, finished, open }) {
    this.place = place
    this.open = open
    const label = esc(t(open ? 'learn.hideMission' : 'learn.showMission'))
    const toggle = (cls, text, attrs = '') =>
      `<button type="button" class="${cls}" data-rail="toggle" aria-controls="${this.controls}" aria-expanded="${open}" title="${label}" ${attrs}>${text}</button>`
    let steps = ''
    if (place) {
      const mission = pack.missions[place.mission]
      const count = mission.flow.length
      const buttons = mission.flow
        .map((item, i) => {
          const done = item.type !== 'quiz' && finished.has(item.id)
          const here = i === place.step
          const name = t('learn.railStep', { step: i + 1, count, title: item.title }) + (done ? ` ${t('learn.railDone')}` : '')
          return `<li><button type="button" class="rail-step" data-rail-step="${i}" data-done="${done}" title="${esc(name)}" aria-label="${esc(name)}"${here ? ' aria-current="step"' : ''}>${item.type === 'quiz' ? '?' : i + 1}</button></li>`
        })
        .join('')
      const n = place.mission + 1
      steps = `<button type="button" class="rail-mission" data-rail-step="-1" title="${esc(t('learn.railIntro', { n }))}" aria-label="${esc(t('learn.railIntro', { n }))}"${place.step === -1 ? ' aria-current="step"' : ''}>${esc(t('learn.missionN', { n }))}</button>
        <ol class="rail-steps">${buttons}</ol>`
    }
    this.root.innerHTML = `${toggle('rail-toggle', '<span aria-hidden="true">🧭</span>', `aria-label="${label}"`)}
      ${steps}
      <span class="rail-spacer"></span>
      ${toggle('rail-chevron', open ? '›' : '‹', 'tabindex="-1" aria-hidden="true"')}`
    this.root.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' })
  }

  /** The button that opens and closes the drawer, for focus to come back to. */
  get toggleButton() {
    return this.root.querySelector('.rail-toggle')
  }

  _click(e) {
    const el = e.target.closest('[data-rail], [data-rail-step]')
    if (!el) return
    if (el.dataset.rail === 'toggle') return this.dispatchEvent(new Event('toggle'))
    const step = Number(el.dataset.railStep)
    // The step on show, with the drawer open: the student wants it out of the way.
    if (this.open && this.place && step === this.place.step) return this.dispatchEvent(new Event('toggle'))
    this.dispatchEvent(new CustomEvent('go', { detail: { mission: this.place.mission, step } }))
  }
}
