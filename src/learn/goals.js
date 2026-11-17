/**
 * Watches what the student does while an objective is open and says which of
 * its goals are met: the program as it changes, each run and how it ended,
 * the output, and things done in the app. A goal once met stays met. Fires
 * `goals` with [met?] for the objective's goals whenever that changes.
 */
import { State } from '../device/device-target.js'
import { met, regexesOf } from './checks.js'

const SETTLE_MS = 300 // a program still being typed is checked once it pauses

export class GoalWatcher extends EventTarget {
  /**
   * `device`: the app's device (its state, data and program-error events);
   * `program()`: the student's program as Python; `tester`: a RegexTester.
   */
  constructor({ device, program, tester }) {
    super()
    this.program = program
    this.tester = tester
    this.goals = null
    this.done = []
    this.seen = null
    this.run = null // { started, failed } while a program runs
    this.line = ''
    this.decoder = new TextDecoder()
    device.addEventListener('state', (e) => this._state(e.detail.state))
    device.addEventListener('program-error', () => this.run && (this.run.failed = true))
    device.addEventListener('data', (e) => this._data(e.detail))
  }

  /** Watch an objective's goals, `done` being those met before. */
  start(goals, done = []) {
    this.goals = goals
    this.done = goals.map((_, i) => !!done[i])
    this.seen = { program: this.program(), runs: [], events: [], printed: new Set(), picked: new Set() }
    this._check()
  }

  stop() {
    this.goals = null
    clearTimeout(this.timer)
  }

  /** The program changed: checked again once it settles. */
  programChanged() {
    if (!this.goals) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.seen.program = this.program()
      this.event('edited')
    }, SETTLE_MS)
  }

  /** Something the student did in the app (docs/mission-packs.md, the `event` check). */
  event(name, detail) {
    if (!this.goals) return
    this.seen.events.push({ name, detail })
    this._check()
  }

  /** The student clicked a part of the simulated board. */
  async pick(part) {
    await this._match('pick', part, this.seen?.picked)
  }

  _state(state) {
    if (state === State.RUNNING && !this.run) this.run = { started: performance.now(), failed: false }
    else if (state !== State.RUNNING && this.run) {
      const { started, failed } = this.run
      this.run = null
      if (!this.goals) return
      this.seen.runs.push({ ok: !failed, seconds: (performance.now() - started) / 1000 })
      this._check()
    }
  }

  _data(bytes) {
    const text = typeof bytes === 'string' ? bytes : this.decoder.decode(bytes, { stream: true })
    // Terminal colours and cursor moves are not part of what the program printed.
    const lines = (this.line + text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')).split(/\r?\n/)
    this.line = lines.pop().slice(-1000)
    for (const line of lines) this._match('prints', line.replace(/\r/g, ''), this.seen?.printed)
  }

  /** Test what happened against the open objective's regexes of one kind; record and check any that match. */
  async _match(kind, text, into) {
    if (!this.goals || !into) return
    const goals = this.goals
    for (const regex of new Set(goals.flatMap((g) => regexesOf(g.check, kind)))) {
      if (into.has(regex)) continue
      if ((await this.tester.test(regex, text)) && this.goals === goals) {
        into.add(regex)
        this._check()
      }
    }
  }

  _check() {
    if (!this.goals) return
    const now = this.goals.map((g, i) => this.done[i] || met(g.check, this.seen))
    if (now.some((m, i) => m !== this.done[i])) {
      this.done = now
      this.dispatchEvent(new CustomEvent('goals', { detail: now }))
    }
  }
}
