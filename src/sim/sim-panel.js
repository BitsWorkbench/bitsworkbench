// The simulator's panel: the 3D view and its controls (camera, room, speed,
// the board's buttons). Pause and Step are the app's run controls, in the top
// bar. It builds its own DOM inside `host`.
import './sim.css'
import { COURSES } from './world/courses.js'
import { KINDS, ROOMS, CAMERA_MODES } from './kinds.js'
import { holdButton } from './hold-button.js'
import { SettingsPanel } from './settings-panel.js'
import { t, tHtml } from '../i18n/index.js'

const SPEEDS = [0.5, 1, 2, 4]

// CodeSpace's icons for the room, the camera and centring it (Material Icons,
// Apache License 2.0: filter_hdr, videocam, center_focus_strong).
const icon = (d) => `<svg class="sim-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
const ROOM_ICON = icon('M14 6l-3.75 5 2.85 3.8-1.6 1.2C9.81 13.75 7 10 7 10l-6 8h22L14 6z')
const CAMERA_ICON = icon('M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z')
const CENTER_ICON = icon('M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm-7 7H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4z')

// A board's two buttons (BTN 0 and 1), as the panel and the boards page show them.
export function boardButtonsHtml() {
  return [0, 1].map((n) => `<button type="button" class="sim-board-btn" data-n="${n}" title="${tHtml('simPanel.buttonTitle', { n })}">${tHtml('simPanel.buttonFace', { n })}</button>`).join('\n')
}

// CodeX's keys (BTN_U .. BTN_B = 0 .. 5): its direction pad, then B and A,
// as the panel and the boards page show them.
export function codexButtonsHtml() {
  const key = (b, n, face, label) => `<button type="button" class="cx-btn cx-${b}" data-b="${n}" title="${tHtml(label)}" aria-label="${tHtml(label)}"><span aria-hidden="true">${face}</span></button>`
  return `<span class="cx-pad" role="group" aria-label="${tHtml('codex.pad')}">${key('L', 3, '◀', 'codex.left')}${key('U', 0, '▲', 'codex.up')}${key('D', 2, '▼', 'codex.down')}${key('R', 1, '▶', 'codex.right')}</span>`
    + `${key('B', 5, 'B', 'codex.buttonB')}${key('A', 4, 'A', 'codex.buttonA')}`
}

export class SimPanel {
  constructor(host, sim) {
    this.sim = sim
    // title and aria-label from one key
    const both = (key) => `title="${tHtml(key)}" aria-label="${tHtml(key)}"`
    host.innerHTML = `
      <div class="sim-stage" data-off="true">
        <div class="sim-view"></div>
      </div>
      <div class="sim-bar" role="toolbar" aria-label="${tHtml('simPanel.bar')}" hidden>
        <span class="sim-group" data-for="codebot codeair">
          <label class="sim-pick" title="${tHtml('simPanel.roomTitle')}">${ROOM_ICON}<select class="sim-room" aria-label="${tHtml('simPanel.room')}"></select></label>
        </span>
        <span class="sim-group" data-for="codebot codeair">
          <label class="sim-pick">${CAMERA_ICON}<select class="sim-camera" aria-label="${tHtml('simPanel.camera')}"></select></label>
          <button type="button" class="icon-btn sim-center" ${both('simPanel.center')}>${CENTER_ICON}</button>
        </span>
        <span class="sim-group" data-for="codebot">
          <label title="${tHtml('simPanel.courseTitle')}"><span aria-hidden="true">〰️</span> <select class="sim-course" aria-label="${tHtml('simPanel.course')}"></select></label>
        </span>
        <span class="sim-group" data-for="codex">
          <label title="${tHtml('simPanel.lightTitle')}"><span aria-hidden="true">💡</span> <input type="range" class="sim-light" min="0" max="1000" value="250" aria-label="${tHtml('simPanel.light')}"></label>
        </span>
        <span class="sim-group">
          <select class="sim-speed" ${both('simPanel.speed')}></select>
        </span>
        <span class="sim-group sim-buttons" data-for="codebot codeair" role="group" aria-label="${tHtml('simPanel.buttons')}">
          ${boardButtonsHtml()}
        </span>
        <span class="sim-group sim-buttons" data-for="codex" role="group" aria-label="${tHtml('simPanel.buttons')}">
          ${codexButtonsHtml()}
        </span>
        <button type="button" class="icon-btn sim-full" data-for="codex" ${both('codex.fullTitle')}>⛶</button>
        <a class="sim-chip sim-boards" data-for="codex codeair" href="./boards.html" target="_blank" rel="noopener" title="${tHtml('simPanel.moreBoardsTitle')}">${tHtml('simPanel.moreBoards')}</a>
        <button type="button" class="sim-chip sim-reset" data-for="codebot codeair" title="${tHtml('simPanel.reset')}"><span aria-hidden="true">↺</span> ${tHtml('simPanel.resetShort')}</button>
        <button type="button" class="icon-btn sim-gear" ${both('settings.open')}>⚙️</button>
      </div>`
    const q = (s) => host.querySelector(s)
    this.stage = q('.sim-stage')
    this.bar = q('.sim-bar')
    sim.attachView(q('.sim-view'))
    this.settings = new SettingsPanel(this.stage, q('.sim-gear'), sim)

    // the camera menu; its title says how the one chosen moves
    const camera = (this.cameraSelect = q('.sim-camera'))
    for (const mode of CAMERA_MODES) camera.add(new Option(t(`simPanel.cam.${mode}`), mode))
    const shown = (mode) => {
      camera.value = mode
      camera.title = t(`simPanel.camHelp.${mode}`)
    }
    camera.addEventListener('change', () => sim.setCamera(camera.value))
    sim.addEventListener('camera', (e) => shown(e.detail))
    shown(sim.cameraMode)
    q('.sim-center').addEventListener('click', () => sim.setCamera(sim.cameraMode))

    const course = (this.courseSelect = q('.sim-course'))
    course.add(new Option(t('simPanel.noCourse'), ''))
    for (const [id, c] of Object.entries(COURSES)) course.add(new Option(c.name, id))
    course.addEventListener('change', () => sim.setCourse(course.value))

    const room = (this.roomSelect = q('.sim-room'))
    for (const [id, name] of Object.entries(ROOMS)) room.add(new Option(name, id))
    room.addEventListener('change', () => sim.setRoom(room.value))

    const speed = q('.sim-speed')
    for (const v of SPEEDS) speed.add(new Option(t('simPanel.speedValue', { speed: v === 0.5 ? '½' : v }), v, v === 1, v === 1))
    speed.addEventListener('change', () => sim.setSpeed(Number(speed.value)))

    q('.sim-reset').addEventListener('click', () => sim.reset())
    q('.sim-light').addEventListener('input', () => sim.setLight(Number(q('.sim-light').value)))

    for (const b of host.querySelectorAll('.sim-board-btn')) {
      const n = Number(b.dataset.n)
      holdButton(b, (down) => sim.press(n, down))
    }
    for (const b of host.querySelectorAll('.cx-btn')) {
      const n = Number(b.dataset.b)
      holdButton(b, (down) => sim.press(n, down))
    }
    q('.sim-full').addEventListener('click', () => sim.view?.fullScreen?.())

    sim.addEventListener('state', () => this.refresh())
    sim.addEventListener('device', () => this.refresh())
  }

  refresh() {
    const on = this.sim.isConnected
    this.stage.dataset.off = String(!on)
    this.bar.hidden = !on
    for (const el of this.bar.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(this.sim.targetId)
    this.courseSelect.disabled = this.roomSelect.disabled = this.sim.state === 'running'
    if (on) this.roomSelect.value = this.sim.room ?? KINDS[this.sim.targetId]?.env
    if (!on) this.settings.close({ focus: false })
    this.settings.refresh()
  }
}
