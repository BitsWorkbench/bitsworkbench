/** Wires the workspace, the board and the chrome around them together. */
import { State, createDevice, deviceKindFromUrl } from '../device/device-target.js'
// Each import registers a kind of device. Add a simulator the same way.
import '../device/device-manager.js'
import '../device/loopback-device.js'
import { SUPPORTED_TARGETS, getTarget } from '../device/targets.js'
import * as Blockly from 'blockly/core'
import { BlockWorkspace, STARTER_PROJECTS, fileNameFor } from '../workspace/workspace.js'
import { generatePython, generateWithLines, devicesUsed, boardOfPython } from '../blocks/index.js'
import { TerminalPanel } from './terminal.js'
import { toast, showModal } from './notify.js'
import { examplesFor, exampleProject, EXAMPLE_DEVICES } from '../examples/index.js'
import { t, listOf, LANGUAGES, language, languageName, setLanguage } from '../i18n/index.js'
import { DeviceSwitch } from '../sim/device-switch.js'
import { SimDevice } from '../sim/sim-device.js'   // registers the 'sim' kind
import { SimPanel } from '../sim/sim-panel.js'
import { PythonEditor } from '../editor/python-editor.js'
import { SnippetPalette } from '../editor/palette.js'
import { pythonToBlocks } from '../convert/to-blocks.js'
import { createFileStores } from '../files/store.js'
import { createMyBlocksStore } from '../my-blocks/store.js'
import { installMyBlocks } from '../my-blocks/blocks.js'
import { FilesPanel } from './files-panel.js'
import { Learn } from '../learn/learn.js'

const SEEN_WELCOME = 'opencodebot.welcomed.v1'
const PICKED_DEVICE = 'opencodebot.device.v1'
const TERMINAL_PANEL = 'opencodebot.terminalPanel.v1'
const OPEN_FILE = 'opencodebot.openFile.v1'
const LAYOUTS = 'opencodebot.layouts.v1'
const TAB_LOCK = 'opencodebot.editing'
/** How many of a board's examples, easiest first, Learn shows as quick starts. */
const QUICK_STARTS = 2

/** A path's last part: its file name. */
const baseName = (path) => path.split('/').pop()

const $ = (id) => document.getElementById(id)

export class App {
  constructor() {
    // The kind the page was opened with (?device=) is the board; the simulator
    // sits beside it, behind Simulate. ?device=sim opens in the simulator.
    const kind = deviceKindFromUrl()
    this.device = new DeviceSwitch(createDevice(kind === 'sim' ? 'serial' : kind), createDevice('sim'))
    this.simPanel = new SimPanel($('sim-host'), this.device.sim)
    this.pickedTarget = localStorage.getItem(PICKED_DEVICE) || null

    this.workspace = new BlockWorkspace($('blockly-root'), this.pickedTarget)
    // The student's own saved Python blocks, in this browser, for every project.
    this.myBlocks = createMyBlocksStore()
    installMyBlocks(this.workspace.workspace, this.myBlocks, {
      saved: () => toast({ kind: 'info', title: t('myBlocks.saved'), detail: t('myBlocks.savedDetail') }),
    })
    this.terminal = new TerminalPanel($('terminal-host'), (data) => this.device.sendRaw(data))
    // Mission packs: the tutorial pane at the right of the work area.
    this.learn = new Learn({
      pane: $('learn-pane'),
      splitter: $('learn-splitter'),
      workarea: document.querySelector('.workarea'),
      onResize: () => this._refitSide?.(),
    })
    $('pack-input').addEventListener('change', (e) => {
      this.learn.openFile(e.target.files?.[0])
      e.target.value = ''
    })

    this._bindDevice()
    this._bindChrome()
    // A paused program's line, on its block and in the Python view.
    this.device.sim.addEventListener('line', (e) => this._showLine(e.detail.line))
    this._bindWorkspace()
    this._bindTextMode()

    if (!this.workspace.restore() && this.pickedTarget) {
      this.workspace.loadProject(STARTER_PROJECTS[this.pickedTarget] || { blocks: {} })
    }
    // After the restore: bringing back the saved project does not close the open file.
    this._bindFiles()
    this._showMode()

    this._greet()
    this._renderDevicePicker()
    this._renderLanguages()
    this._refreshDeviceChip()
    this._checkBrowser()
    this._maybeWelcome()
    this.learn.restore().catch((err) => console.warn('learn', err))

    // A board that is already plugged in and paired can just come back.
    this.device.autoConnect().catch(() => {})
    if (kind === 'sim') this._toggleSimulate()
  }

  _greet() {
    this.terminal.write(`\x1b[32m${t('term.greeting')}\x1b[0m\r\n\x1b[90m${t('term.greetingHint')}\x1b[0m\r\n`)
  }

  // ------------------------------------------------------------- device

  _bindDevice() {
    const device = this.device

    device.addEventListener('data', (e) => this.terminal.write(e.detail))

    device.addEventListener('state', (e) => {
      const { state, message } = e.detail
      this._setStatus(state, message)
      this._refreshButtons()
      this._refreshDeviceChip()
      this._refreshSide()
    })

    device.addEventListener('device', (e) => {
      const { targetId, target, firmware } = e.detail
      if (targetId && target?.supported) {
        this._adoptConnectedTarget(targetId)
        if (firmware) {
          this.terminal.say(t('term.connected', { device: target.name, version: firmware.version, date: firmware.date }))
        }
      }
      this._refreshDeviceChip()
      this._refreshButtons()
    })

    device.addEventListener('notice', (e) => toast(e.detail))

    device.addEventListener('program-error', (e) => {
      const { name, message, line } = e.detail
      toast({
        kind: 'error',
        title: friendlyErrorTitle(name),
        detail: [message, line ? t('error.atLine', { line }) : ''].filter(Boolean).join(' '),
      })
      this._setStatus('error', t('status.programError', { name, message }))
    })

    device.addEventListener('progress', (e) => {
      const pct = Math.round(e.detail * 100)
      this._setStatus(State.LOADING, t('status.sendingPct', { pct }))
    })
  }

  /** When a real board shows up, follow it — that is what the student has. */
  _adoptConnectedTarget(targetId) {
    if (this.workspace.targetId === targetId) return
    const used = devicesUsed(this.workspace.workspace)
    const conflicting = [...used].filter((id) => id !== targetId)
    this.workspace.setTarget(targetId)
    this.pickedTarget = targetId
    localStorage.setItem(PICKED_DEVICE, targetId)
    this._renderDevicePicker()

    const device = getTarget(targetId)?.name
    if (conflicting.length) {
      toast({
        kind: 'warn',
        title: t('switched.title', { device }),
        detail: t('switched.detail', { names: deviceNames(conflicting) }),
      })
    } else if (this.workspace.isEmpty) {
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
      toast({ kind: 'info', title: t('adopted.readyTitle', { device }), detail: t('adopted.readyDetail') })
    } else {
      toast({ kind: 'info', title: t('adopted.connectedTitle', { device }), detail: t('adopted.connectedDetail') })
    }
  }

  async _toggleSimulate() {
    if (this.device.simulating) {
      await this.device.disconnect()
      this._refreshSimButton()
      return
    }
    const target = this.pickedTarget || 'codebot'
    if (!SimDevice.canSimulate(target)) {
      const [title, detail] = SimDevice.whyNot(target)
      toast({ kind: 'warn', title, detail })
      return
    }
    // A board on USB gives way to the simulator, once the student agrees.
    if (this.device.isConnected && !(await this._confirmLeave(t('leave.toSim')))) return
    this._roomForSim()
    await this.device.simulate(target)
    this._refreshSimButton()
  }

  /** Ask before leaving the board in use (on USB or in the simulator) for the other kind; its program stops. */
  _confirmLeave(confirmText) {
    const sim = this.device.simulating
    const device = getTarget(this.device.targetId)?.name || ''
    return showModal({
      title: t(sim ? 'leave.simTitle' : 'leave.boardTitle', { device }),
      bodyHtml: t(this.device.state === State.RUNNING ? 'leave.runningBodyHtml' : 'leave.bodyHtml', { device }),
      confirmText,
      cancelText: t(sim ? 'leave.keepSim' : 'leave.keepBoard', { device }),
    })
  }

  _refreshSimButton() {
    const on = this.device.simulating
    const b = $('btn-sim')
    b.dataset.connected = String(on)
    b.querySelector('.btn-text').textContent = t(on ? 'btn.stopSimulator' : 'btn.simulate')
  }

  async _toggleConnect() {
    if (this.device.isConnected && !this.device.simulating) {
      await this.device.disconnect()
      this.terminal.warn(t('term.disconnected'))
      return
    }
    // The simulator gives way to a board on USB, once the student agrees.
    if (this.device.simulating && !(await this._confirmLeave(t('leave.toBoard')))) return
    const ok = await this.device.connect()
    this._refreshSimButton()
    if (ok) this.terminal.focus()
  }

  async _run() {
    const textMode = this.workspace.mode === 'text'
    if (textMode ? !this.workspace.pythonText.trim() : this.workspace.isEmpty) {
      toast({
        kind: 'warn',
        title: t('run.emptyTitle'),
        detail: t(textMode ? 'run.emptyTextDetail' : 'run.emptyDetail'),
      })
      return
    }
    const target = this.device.targetId
    const used = textMode ? new Set() : devicesUsed(this.workspace.workspace)
    const wrong = [...used].filter((id) => id !== target)
    if (target && wrong.length) {
      toast({
        kind: 'warn',
        title: t('run.wrongTitle'),
        detail: t('run.wrongDetail', { names: deviceNames(wrong), device: getTarget(target)?.name }),
      })
      return
    }

    // Typed Python runs as typed, with no blocks behind its lines (line n is
    // the editor's line n); the blocks' Python knows which block made each line.
    const { code, blockAt } = textMode
      ? { code: this.workspace.pythonText, blockAt: {} }
      : generateWithLines(this.workspace.workspace, this.workspace.targetId)
    this._ran = { code, blockAt, text: textMode }
    this.terminal.say(t('term.sending'))
    await this.device.run(code)
  }

  // Mark the line a paused program is at (null: none): typed Python's line in
  // the editor, while it still holds the program that runs; else on its block.
  _showLine(line) {
    const ws = this.workspace.workspace
    const id = line && this._ran?.blockAt[line]
    ws.highlightBlock?.(id && ws.getBlockById(id) ? id : null)
    if (this._ran?.text) {
      const editor = this.pythonEditor
      editor.showLine(line && editor.value === this._ran.code ? line : null)
    }
  }

  async _stop() {
    await this.device.stop()
  }

  // Pause and Step are the simulator's: a real board cannot hold a program
  // still. Step runs the program on to its next line and pauses there.
  _togglePause() {
    const sim = this.device.sim
    if (!this.device.simulating || this.device.state !== State.RUNNING) return
    if (sim.paused) sim.resume()
    else sim.pause()
  }

  _step() {
    if (this.device.simulating && this.device.state === State.RUNNING) this.device.sim.stepLine()
  }

  // ------------------------------------------------------------ chrome

  _bindChrome() {
    $('btn-learn').addEventListener('click', () => this._openLearn())
    $('btn-connect').addEventListener('click', () => this._toggleConnect())
    $('btn-sim').addEventListener('click', () => this._toggleSimulate())
    $('btn-run').addEventListener('click', () => this._run())
    $('btn-stop').addEventListener('click', () => this._stop())
    $('btn-pause').addEventListener('click', () => this._togglePause())
    $('btn-step').addEventListener('click', () => this._step())
    $('btn-clear-term').addEventListener('click', () => this.terminal.clear())
    $('btn-term-toggle').addEventListener('click', () => this._setTermOpen(!this.termOpen))
    // The browser tab shows the program's file.
    this.workspace.addEventListener('rename', () => {
      document.title = t('project.pageTitle', { name: this.workspace.name })
    })

    // Device picker
    const chip = $('device-chip')
    const menu = $('device-menu')
    chip.addEventListener('click', () => this._togglePopover(chip, menu))

    // Overflow menu
    const menuBtn = $('btn-menu')
    const appMenu = $('app-menu')
    menuBtn.addEventListener('click', () => this._togglePopover(menuBtn, appMenu))
    appMenu.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action
      if (!action) return
      this._togglePopover(menuBtn, appMenu, false)
      this._menuAction(action)
    })

    document.addEventListener('click', (e) => {
      if (!chip.contains(e.target) && !menu.contains(e.target)) this._togglePopover(chip, menu, false)
      if (!menuBtn.contains(e.target) && !appMenu.contains(e.target)) {
        this._togglePopover(menuBtn, appMenu, false)
      }
    })

    $('file-input').addEventListener('change', (e) => this._importFile(e.target.files?.[0]))

    // Escape closes an open menu and returns focus to the button that opened it.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      for (const [button, panel] of [
        [chip, menu],
        [menuBtn, appMenu],
      ]) {
        if (!panel.hidden) {
          this._togglePopover(button, panel, false)
          button.focus()
          e.stopImmediatePropagation()
        }
      }
    })

    // Run and Save work from anywhere, the terminal included: caught on the
    // way down, before the terminal takes the keys for itself.
    document.addEventListener(
      'keydown',
      (e) => {
        const meta = e.ctrlKey || e.metaKey
        if (meta && e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          this._run()
        } else if (meta && e.key.toLowerCase() === 's') {
          e.preventDefault()
          e.stopPropagation()
          this._saveNow()
        }
      },
      true,
    )
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.device.state === State.RUNNING && !$('python-editor').contains(e.target)) {
        this._stop()
      }
    })

    this._bindSplitter()
    this._bindTermSplitter()
    window.addEventListener('resize', () => {
      this.workspace.resize()
      this._fitTerm()
      this.terminal.resize()
    })
  }

  _togglePopover(button, panel, force) {
    const open = force ?? panel.hidden
    panel.hidden = !open
    button.setAttribute('aria-expanded', String(open))
  }

  // ------------------------------------------------------------ side pane

  /**
   * The side: the simulator on top while it is on (starting included), the
   * terminal panel under it. With no simulator the terminal fills the side
   * and cannot be closed; with one, it can be closed to its header or resized.
   */
  _refreshSide() {
    const sim = this.device.active === this.device.sim && this.device.sim.state !== State.OFFLINE
    const side = $('side-pane')
    side.dataset.sim = String(sim)
    side.dataset.term = this.termOpen ? 'open' : 'closed'
    $('panel-sim').hidden = !sim
    $('term-splitter').hidden = !sim || !this.termOpen
    $('term-body').hidden = sim && !this.termOpen
    const toggle = $('btn-term-toggle')
    toggle.hidden = !sim
    toggle.textContent = this.termOpen ? '▾' : '▴'
    toggle.setAttribute('aria-expanded', String(this.termOpen))
    const label = t(this.termOpen ? 'term.hide' : 'term.show')
    toggle.title = label
    toggle.setAttribute('aria-label', label)
    // After the simulator's own panel has caught up (its bar shows once it is ready).
    requestAnimationFrame(() => this._fitTerm())
  }

  _setTermOpen(open) {
    this.termOpen = open
    this._saveTerm()
    this._refreshSide()
    requestAnimationFrame(() => this._fitTerm())
  }

  _saveTerm() {
    try {
      localStorage.setItem(TERMINAL_PANEL, JSON.stringify({ open: this.termOpen, height: this.termHeight }))
    } catch {}
  }

  /** Clamp the terminal's height to the side as it is now, and resize what is in it. */
  _fitTerm() {
    const side = $('side-pane')
    const room = side.getBoundingClientRect().height
    const head = document.querySelector('.term-head').getBoundingClientRect().height
    // The simulator keeps its bar and at least 120 px of view above the divider.
    const simBar = document.querySelector('.sim-bar')?.getBoundingClientRect().height || 0
    const least = head + 60
    const height = Math.round(Math.min(Math.max(this.termHeight, least), Math.max(least, room - 6 - simBar - 120)))
    side.style.setProperty('--term-h', `${height}px`)
    if (room > 0) {
      $('term-splitter').setAttribute('aria-valuenow', String(Math.round(100 - (height / room) * 100)))
    }
    this.device.sim.view?.resize()
    this.terminal.resize()
    return height
  }

  _bindTermSplitter() {
    try {
      const saved = JSON.parse(localStorage.getItem(TERMINAL_PANEL) || '{}')
      this.termOpen = saved.open !== false
      this.termHeight = Number(saved.height) || 220
    } catch {
      this.termOpen = true
      this.termHeight = 220
    }
    this._refreshSide()

    const splitter = $('term-splitter')
    const set = (px) => {
      this.termHeight = px
      this.termHeight = this._fitTerm()
      this._saveTerm()
    }
    let dragging = false
    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      splitter.setPointerCapture(e.pointerId)
    })
    splitter.addEventListener('pointermove', (e) => {
      if (dragging) set($('side-pane').getBoundingClientRect().bottom - e.clientY)
    })
    splitter.addEventListener('pointerup', () => {
      dragging = false
    })
    // Up makes the terminal taller, Down shorter; Shift moves further.
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 120 : 40
      const grow = { ArrowUp: step, ArrowDown: -step }[e.key]
      if (!grow) return
      e.preventDefault()
      set(this.termHeight + grow)
    })
  }

  _bindSplitter() {
    const splitter = $('splitter')
    const workarea = document.querySelector('.workarea')
    let dragging = false
    const vertical = () => window.matchMedia('(max-width: 880px)').matches

    /** Size the side pane in pixels, clamped, and report it as a percentage. */
    const setSide = (px) => {
      const rect = workarea.getBoundingClientRect()
      let pct
      if (vertical()) {
        // An open tutorial pane is a row of its own, under the side, taking 40% of the height.
        const learnH = this.learn.isOpen ? Math.round(rect.height * 0.4) : 0
        // With the tutorial open, the side gives the editor most of what is left.
        const most = learnH ? (rect.height - learnH) * 0.4 : rect.height - 140
        const height = Math.min(Math.max(px, 120), most)
        workarea.style.gridTemplateRows = `1fr 6px ${height}px${learnH ? ` ${learnH}px` : ''}`
        pct = 100 - (height / rect.height) * 100
      } else {
        const width = Math.min(Math.max(px, 220), rect.width - 280 - this.learn.width)
        workarea.style.setProperty('--side-w', `${width}px`)
        pct = 100 - (width / rect.width) * 100
      }
      // The value is the blocks area's share, which is what moving it changes.
      splitter.setAttribute('aria-valuenow', String(Math.round(pct)))
      this.workspace.resize()
      this.terminal.resize()
    }
    const sideNow = () => {
      const side = $('side-pane').getBoundingClientRect()
      return vertical() ? side.height : side.width
    }

    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      splitter.setPointerCapture(e.pointerId)
    })
    splitter.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const rect = workarea.getBoundingClientRect()
      setSide(vertical() ? rect.bottom - e.clientY : rect.right - e.clientX)
    })
    splitter.addEventListener('pointerup', () => {
      dragging = false
    })

    // Arrow keys move the divider, so it works without a mouse.
    splitter.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 120 : 40
      const grow = vertical() ? { ArrowUp: step, ArrowDown: -step } : { ArrowLeft: step, ArrowRight: -step }
      if (!(e.key in grow)) return
      e.preventDefault()
      setSide(sideNow() + grow[e.key])
    })
    requestAnimationFrame(() => setSide(sideNow()))
    // The tutorial pane opened, closed or changed width: the side fits again.
    this._refitSide = () => setSide(sideNow())

    // On a narrow screen the side is a strip under the blocks: the simulator
    // and the terminal both need more of it, so starting the simulator grows it.
    this._roomForSim = () => {
      if (!vertical()) return
      const want = workarea.getBoundingClientRect().height * 0.6
      if (sideNow() < want) setSide(want)
    }
  }

  // -------------------------------------------------------- device chip

  _renderDevicePicker() {
    const menu = $('device-menu')
    menu.innerHTML = '<div class="dm-head"></div>'
    menu.firstChild.textContent = t('chip.menuHead')
    for (const target of SUPPORTED_TARGETS) {
      const item = document.createElement('button')
      item.type = 'button'
      item.setAttribute('role', 'option')
      item.setAttribute('aria-selected', String(target.id === this.workspace.targetId))
      item.innerHTML = `
        <img src="./icons/${target.icon}" alt="" width="26" height="26" />
        <span>
          <span class="dm-title"></span>
          <span class="dm-sub"></span>
        </span>`
      item.querySelector('.dm-title').textContent = target.fullName
      item.querySelector('.dm-sub').textContent = target.tagline
      item.addEventListener('click', () => {
        this._pickTarget(target.id)
        this._togglePopover($('device-chip'), menu, false)
      })
      menu.appendChild(item)
    }
  }

  async _pickTarget(targetId) {
    // In the simulator another board just takes the place of the one loaded
    // (its program stops). Only a real board plugged in cannot be swapped here.
    const resimulate = this.device.simulating && this.device.targetId !== targetId
    if (resimulate) await this.device.disconnect()
    else if (this.device.isConnected && this.device.targetId && this.device.targetId !== targetId) {
      toast({
        kind: 'warn',
        title: t('pick.otherTitle'),
        detail: t('pick.otherDetail', { device: getTarget(this.device.targetId)?.name }),
      })
      return
    }

    // Nothing asks, and nothing of the student's is thrown away: an empty
    // canvas, or the old board's starter just as it came, becomes the new
    // board's starter; any other program stays as it is (saved in this
    // browser), for the student to keep or to swap for another file. Blocks
    // the new board cannot run are named in a toast. (In text mode Run sends
    // the typed Python, so blocks for another board do not matter.)
    const startFresh = this.workspace.isEmpty || this.workspace.isStarter
    const strays =
      startFresh || this.workspace.mode === 'text'
        ? []
        : [...devicesUsed(this.workspace.workspace)].filter((id) => id !== targetId)

    this.pickedTarget = targetId
    localStorage.setItem(PICKED_DEVICE, targetId)
    this.workspace.setTarget(targetId)
    if (startFresh) {
      this.workspace.clear()
      this.workspace.loadProject(STARTER_PROJECTS[targetId] || { blocks: {} })
    } else if (strays.length) {
      toast({
        kind: 'info',
        title: t('switched.title', { device: getTarget(targetId)?.name }),
        detail: t('switched.detail', { names: deviceNames(strays) }),
      })
    }
    this._renderDevicePicker()
    this._refreshDeviceChip()
    if (resimulate) await this._toggleSimulate()
    else this._refreshSimButton()
  }

  _refreshDeviceChip() {
    const chip = $('device-chip')
    const connected = this.device.isConnected
    const target = getTarget(this.device.targetId || this.workspace.targetId)
    const dot = chip.querySelector('.device-chip-dot')

    chip.dataset.connected = String(connected)
    dot.dataset.state = connected
      ? this.device.state === State.LOADING
        ? 'busy'
        : 'on'
      : 'off'
    $('device-chip-label').textContent = target ? target.name : t('chip.pick')
    $('device-chip-icon').src = `./icons/${target?.icon || 'dev-any.svg'}`

    const usb = connected && !this.device.simulating
    const connect = $('btn-connect')
    connect.dataset.connected = String(usb)
    connect.querySelector('.btn-text').textContent = t(usb ? 'btn.disconnect' : 'btn.connect')
    connect.querySelector('.btn-emoji').textContent = usb ? '✅' : '🔌'
    this._refreshSimButton()
  }

  /**
   * At rest only Run shows. Running: Stop, and in the simulator Pause. Once
   * paused, Pause says Resume and Step shows too; both stay until the
   * program stops, then it is Run alone again. A button that hides while it
   * has the keyboard hands it to the one now in its place.
   */
  _refreshButtons() {
    const connected = this.device.isConnected
    const running = connected && this.device.state === State.RUNNING
    const sim = running && this.device.simulating
    const paused = sim && this.device.sim.paused
    if (paused) this._stepping = true
    if (!running) this._stepping = false

    const had = document.activeElement
    const run = $('btn-run')
    const stop = $('btn-stop')
    const pause = $('btn-pause')
    const step = $('btn-step')
    run.hidden = running
    run.disabled = !connected || this.device.state === State.LOADING
    stop.hidden = !running
    pause.hidden = !sim
    step.hidden = !(sim && this._stepping)
    pause.querySelector('.btn-emoji').textContent = paused ? '▶' : '⏸'
    pause.querySelector('.btn-text').textContent = t(paused ? 'btn.resume' : 'btn.pause')

    if ([run, stop, pause, step].includes(had) && had.hidden) {
      ;(running ? (paused ? step : stop) : run).focus()
    }
  }

  _setStatus(state, message) {
    const chip = $('status-chip')
    const known = [State.OFFLINE, State.CONNECTING, State.READY, State.LOADING, State.RUNNING, 'error']
    chip.textContent = t(`status.${known.includes(state) ? state : State.READY}`)
    chip.dataset.state =
      { [State.READY]: 'ready', [State.LOADING]: 'busy', [State.RUNNING]: 'running', error: 'error' }[
        state
      ] || 'idle'
    $('status-msg').textContent = message || ''
  }

  // ---------------------------------------------------------- workspace

  _bindWorkspace() {
    let timer
    this.workspace.addEventListener('change', () => {
      this._refreshHint()
      // Another board, another palette (rebuilt only when the board changed).
      if (this.view === 'python') this.palette.render(this.workspace.targetId)
      clearTimeout(timer)
      timer = setTimeout(() => {
        this.workspace.save()
        this._fileChanged()
      }, 250)
    })
  }

  /**
   * The program as Python, as its file keeps it: typed Python in text mode;
   * else the blocks', except that Python turned into blocks and only looked
   * at stays exactly as it was typed.
   */
  _currentPython() {
    if (this.workspace.mode === 'text') return this.workspace.pythonText
    const python = this._blocksPython()
    const back = this._typedBack
    return back && back.python === python ? back.text : python
  }

  _blocksPython() {
    return generatePython(this.workspace.workspace, this.workspace.targetId)
  }

  _refreshHint() {
    $('blocks-hint').hidden = !this.workspace.hasNoBlocks || this.view === 'python'
  }

  // ------------------------------------------------------- blocks or text

  _bindTextMode() {
    this.pythonEditor = new PythonEditor($('python-editor'), {
      label: t('text.editorLabel'),
      describedBy: 'python-editor-help',
      onChange: (text) => this.workspace.setPythonText(text),
      // Lines that would become grey Python blocks; none while the code does not parse.
      noBlockLines: (text) => {
        const result = this.blocksFromPython(text)
        return result.ok ? result.pythonLines : []
      },
    })
    this.palette = new SnippetPalette($('py-palette'), {
      editor: () => this.pythonEditor,
      beforeUse: () => {},
      myBlocks: () => this.myBlocks.list(),
    })
    this.myBlocks.addEventListener('change', () => this.palette.refresh())
    $('btn-view').addEventListener('click', () => this._toggleView())
    this.workspace.addEventListener('mode', () => this._showMode())
  }

  /** The Python view: the program as Python, there to edit. */
  _toText() {
    // Python that came to blocks and was only looked at comes back exactly
    // as it was typed; once the blocks change, the blocks' Python it is.
    const back = this._typedBack
    const python = this._blocksPython()
    this.workspace.setMode('text', back && back.python === python ? back.text : python)
    this._typedBack = null
    this.pythonEditor.focus()
  }

  /** Python as blocks for the picked board: { ok, state } or { ok: false, line }. */
  blocksFromPython(text) {
    return pythonToBlocks(text, this.workspace.targetId)
  }

  /**
   * The typed Python, turned into blocks. Untouched Python keeps the blocks
   * it came from, as they were; code that does not parse stays Python, with
   * the cursor on the line to fix.
   */
  _toBlocks() {
    const typed = this.workspace.pythonText
    if (typed.trim() !== this._blocksPython().trim()) {
      const result = this.blocksFromPython(typed)
      if (!result.ok) {
        this.pythonEditor.showLine(result.line)
        this.pythonEditor.focus()
        toast({
          kind: 'error',
          title: t('text.notParsedTitle'),
          detail: t('text.notParsedDetail', { line: result.line }),
        })
        return false
      }
      this.workspace.replaceBlocks(result.state)
      this._typedBack = { text: typed, python: this._blocksPython() }
    }
    this.workspace.setMode('blocks')
    return true
  }

  /**
   * The editor area shows the blocks or the Python, never both, and the
   * Python is always there to edit: the switch turns the blocks into Python,
   * or the Python back into blocks (staying in Python at a line that does
   * not parse).
   */
  _toggleView() {
    if (this.workspace.mode === 'text') this._toBlocks()
    else this._toText()
  }

  /** Make the screen match the mode: Python is the Python view, blocks the blocks. */
  _showMode() {
    const python = this.workspace.mode === 'text'
    if (python && this.pythonEditor.value !== this.workspace.pythonText) this.pythonEditor.value = this.workspace.pythonText
    this.view = python ? 'python' : 'blocks'
    $('code-pane').hidden = !python
    $('blockly-root').hidden = python
    if (python) this.palette.render(this.workspace.targetId)
    $('blocks-pane').classList.toggle('is-python', python)
    $('btn-view').setAttribute('aria-checked', String(python))
    this.learn.setMode(python ? 'python' : 'blocks')
    if (!python) this.workspace.resize()
    this._refreshHint()
  }

  // ------------------------------------------------------------- files

  /**
   * The program is always a file: in this browser's own storage, or in a
   * folder on the computer. The open file is { store, folder, path, saved }:
   * which store ('browser' or 'folder'), the folder's name, where in it, and
   * the text last read or written there. Work saves itself to it a moment
   * after each change, and before another file opens or the board changes;
   * the bar's dot shows while a save is waiting, or has failed.
   */
  _bindFiles() {
    this.stores = createFileStores()
    this.openFile = null
    try {
      const f = JSON.parse(localStorage.getItem(OPEN_FILE)) || null
      // Remembered before there were two stores: a file in a folder.
      this.openFile = f && !f.store ? { ...f, store: 'folder' } : f
    } catch {
      // nothing remembered
    }
    this.filesPanel = new FilesPanel($('files-panel'), {
      stores: this.stores,
      open: (ref) => this._openRef(ref),
      create: (store, path, kind) => this._createEntry(store, path, kind),
      rename: (store, from, to) => this._renameEntry(store, from, to),
      remove: (store, path, kind) => this._removeEntry(store, path, kind),
      attach: () => this._attachFolder(false),
      reopen: () => this._attachFolder(true),
    })
    $('btn-files').addEventListener('click', () => this._toggleFiles())
    $('btn-save-again').addEventListener('click', () => this._saveNow())
    $('btn-use-tab').addEventListener('click', () => this._claimTab(true))
    if (!this.openFile) this._startFile()
    else this._setOpenFile(this.openFile)
    this._claimTab()
  }

  /** The first time: the program as it is becomes main.py in this browser. */
  async _startFile() {
    const path = await this._freePath(this.stores.browser, '', 'main.py')
    const text = this._currentPython()
    let saved
    try {
      await this.stores.browser.write(path, text)
      saved = text
    } catch {
      // not written: the dot shows, and the next save tries again
    }
    this._setOpenFile({ store: 'browser', folder: null, path, saved })
  }

  /**
   * One file operation at a time, in order: saves, renames and deletes never
   * overlap, so a save cannot land in the middle of a rename or a delete.
   * Resolves with what `job` gives.
   */
  _inTurn(job) {
    const run = (this._fileQueue || Promise.resolve()).then(job, job)
    this._fileQueue = run.catch(() => {})
    return run
  }

  /** The store a file is in, open and allowed (a folder after a reload is allowed again from a click); null if not. */
  async _storeFor(f, ask) {
    if (f.store === 'browser') return this.stores.browser
    const folder = this.stores.folder
    if (!folder) return null
    if (folder.name === f.folder) return folder
    if (ask && (await folder.remembered()) === f.folder && (await folder.reopen()) === f.folder) return folder
    return null
  }

  /** The program changed: save it to its file a moment later. */
  _fileChanged() {
    this._refreshFile()
    if (this._readOnly) return
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => this._save(false), 750)
  }

  /**
   * Save the program to its file, if it differs from what is there, in turn
   * with other file operations. `ask` (from a click or a key) may ask to
   * allow the folder again. A save that fails says so in the bar, loudly,
   * until one works. Resolves true once the file holds the program.
   */
  _save(ask) {
    clearTimeout(this._saveTimer)
    return this._inTurn(() => this._write(ask))
  }

  /** _save's work, for a job already in turn. */
  async _write(ask) {
    if (this._readOnly) return false
    const f = this.openFile
    if (!f) return true
    const text = this._currentPython()
    this._rememberLayout(f, text)
    if (text === f.saved && !this._saveFailed) return true
    const store = await this._storeFor(f, ask)
    let problem = store ? null : t('files.reopenDetail', { folder: f.folder })
    if (store) {
      try {
        await store.write(f.path, text)
      } catch (err) {
        problem = err.message
      }
    }
    if (this.openFile !== f) return !problem // another file opened meanwhile
    if (problem) {
      if (!this._saveFailed || ask) toast({ kind: 'error', title: t('files.saveFailed', { file: baseName(f.path) }), detail: problem })
      this._saveFailed = true
    } else {
      this._saveFailed = false
      this._setOpenFile({ ...f, saved: text })
    }
    this._refreshFile()
    return !problem
  }

  /**
   * Before another file takes the open one's place: save it. If it cannot be
   * saved, stay, unless the student chooses to leave its changes behind.
   */
  async _leaveFile() {
    if (!this._canWrite()) return false
    if (await this._save(true)) return true
    const f = this.openFile
    return showModal({
      title: t('files.unsavedTitle', { file: baseName(f.path) }),
      bodyHtml: t('files.unsavedBodyHtml', { file: baseName(f.path) }),
      confirmText: t('files.leaveAnyway'),
      cancelText: t('files.stay'),
    })
  }

  /** Ctrl+S, or the bar's button after a failed save: save now, and say so. */
  async _saveNow() {
    if (await this._save(true)) {
      const f = this.openFile
      toast({ kind: 'info', title: t('files.savedTitle'), detail: t('files.savedDetail', { file: f.path, folder: this._placeName(f) }) })
    }
  }

  _placeName(f) {
    return f.store === 'browser' ? t('files.thisBrowser') : f.folder
  }

  /**
   * One tab of this browser edits at a time: they share the saved program
   * and the open file, so two would write over each other. The first holds
   * a lock; another only shows the program, with a button to edit there
   * instead, which takes the lock (the first tab then only shows).
   */
  _claimTab(take = false) {
    if (!navigator.locks) return
    navigator.locks
      .request(TAB_LOCK, take ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) return this._setReadOnly(true)
        // Taken from another tab: start again from what that tab saved.
        if (take) location.reload()
        else this._setReadOnly(false)
        return new Promise(() => {}) // held while this tab is open
      })
      .catch(() => this._setReadOnly(true)) // another tab took it
  }

  /** False, and says why, in a tab that only shows the program: nothing may be written from it. */
  _canWrite() {
    if (!this._readOnly) return true
    toast({ kind: 'warn', title: t('tabs.elsewhereTitle'), detail: t('tabs.elsewhereBody') })
    return false
  }

  _setReadOnly(on) {
    this._readOnly = on
    this.workspace.readOnly = on
    if (on) clearTimeout(this._saveTimer)
    $('tab-elsewhere').hidden = !on
    $('btn-files').disabled = on
    $('btn-view').disabled = on
    if (on) this._toggleFiles(false)
  }

  _setOpenFile(file) {
    this.openFile = file
    if (this._readOnly) return this._refreshFile()
    try {
      if (file) localStorage.setItem(OPEN_FILE, JSON.stringify(file))
      else localStorage.removeItem(OPEN_FILE)
    } catch {
      // storage blocked: the file is forgotten on reload, nothing worse
    }
    if (file) this.workspace.rename(baseName(file.path).replace(/\.py$/i, ''))
    this.filesPanel.setCurrent(file)
    this._refreshFile()
  }

  /** The open file's name in the bar, with a dot while the program differs from it, and a loud button while saving fails. */
  _refreshFile() {
    const f = this.openFile
    $('file-name').textContent = f ? baseName(f.path) : ''
    $('btn-files').title = f ? t('files.buttonTitle', { place: `${this._placeName(f)}/${f.path}` }) : t('files.label')
    $('btn-files').setAttribute('aria-label', f ? t('files.buttonLabel', { file: baseName(f.path) }) : t('files.label'))
    $('file-dirty').hidden = !f || (!this._saveFailed && this._currentPython() === f.saved)
    const again = $('btn-save-again')
    again.hidden = !this._saveFailed
    again.textContent = f?.store === 'folder' ? t('files.allowAgain', { folder: f.folder }) : t('files.saveAgain')
    $('editor-bar').classList.toggle('is-failed', !!this._saveFailed)
  }

  async _toggleFiles(show = $('files-panel').hidden) {
    $('files-panel').hidden = !show
    $('btn-files').setAttribute('aria-expanded', String(show))
    this.workspace.resize()
    if (show) await this._renderFiles()
  }

  async _renderFiles() {
    await this.filesPanel.render()
  }

  /** A name like `name` that is not yet taken in `dir`: blink.py, then blink-2.py. */
  async _freePath(store, dir, name) {
    const [stem, ext] = name.match(/^(.*?)(\.[^.]*)?$/).slice(1)
    for (let n = 1; ; n++) {
      const path = `${dir ? `${dir}/` : ''}${n === 1 ? stem : `${stem}-${n}`}${ext || ''}`
      if (!(await store.exists(path))) return path
    }
  }

  /**
   * Work on another file: this one is saved first; the other opens in the
   * view the student is in (as blocks, the way it was left when its Python is
   * unchanged; else from its Python, which stays Python at a line that does
   * not parse). A file whose imports name another board switches to it.
   */
  async _openRef(ref, { text, left = false } = {}) {
    const f = { store: ref.store, folder: ref.store === 'folder' ? this.stores.folder?.name : null, path: ref.path }
    if (!left && !(await this._leaveFile())) return false
    const store = await this._storeFor(f, true)
    try {
      // In turn with saves: a file is never read while it is being written.
      if (text === undefined) text = await this._inTurn(() => store.read(f.path))
    } catch (err) {
      toast({ kind: 'error', title: t('files.openFailed', { file: baseName(f.path) }), detail: err.message })
      return false
    }
    this._followBoard(text)
    this._typedBack = null
    this._saveFailed = false
    const ws = this.workspace
    const layout = this._layoutFor(f, text)
    this._setOpenFile({ ...f, saved: text })
    if (this.view === 'python') {
      // The blocks behind it, for the way back: as it was left, or none yet.
      if (layout) Blockly.serialization.workspaces.load(layout, ws.workspace)
      else ws.workspace.clear()
      ws.setMode('text', text)
      this.pythonEditor.value = text
      this.pythonEditor.focus()
    } else if (layout) {
      ws.setMode('blocks')
      Blockly.serialization.workspaces.load(layout, ws.workspace)
      this._typedBack = { text, python: this._blocksPython() }
    } else {
      const result = this.blocksFromPython(text)
      if (result.ok) {
        ws.setMode('blocks')
        ws.workspace.clear()
        ws.replaceBlocks(result.state)
        ws.workspace.cleanUp()
        this._typedBack = { text, python: this._blocksPython() }
      } else {
        ws.setMode('text', text)
        this.pythonEditor.showLine(result.line)
        toast({ kind: 'error', title: t('text.notParsedTitle'), detail: t('text.notParsedDetail', { line: result.line }) })
      }
    }
    ws.save()
    this._refreshFile()
    return true
  }

  /** The board a program's imports name, if it is not the one picked: switch to it (not while another board is on USB). */
  _followBoard(text) {
    const board = boardOfPython(text)
    if (!board || board === this.workspace.targetId) return
    const name = getTarget(board)?.name
    if (this.device.isConnected && !this.device.simulating) {
      toast({ kind: 'warn', title: t('files.otherBoardTitle', { device: name }), detail: t('pick.otherDetail', { device: getTarget(this.device.targetId)?.name }) })
      return
    }
    this.pickedTarget = board
    localStorage.setItem(PICKED_DEVICE, board)
    this.workspace.setTarget(board)
    this._renderDevicePicker()
    this._refreshDeviceChip()
    toast({ kind: 'info', title: t('switched.title', { device: name }), detail: t('files.boardFromFile', { device: name }) })
  }

  /** Make a file (empty, and open it) or a folder; null, or what went wrong. */
  async _createEntry(storeKind, path, kind) {
    if (!this._canWrite()) return t('tabs.elsewhereTitle')
    const store = this.stores[storeKind]
    if (await store.exists(path)) return t('files.exists', { name: baseName(path) })
    // A new file opens at once: the open one is saved first (or left by choice).
    if (kind === 'file' && !(await this._leaveFile())) return t('files.notLeft')
    try {
      if (kind === 'dir') await store.mkdir(path)
      else await store.write(path, '')
    } catch (err) {
      return err.message
    }
    if (kind === 'file') await this._openRef({ store: storeKind, path }, { text: '', left: true })
    return null
  }

  /** Rename a file or folder, in turn with saves, the open file following it; null, or what went wrong. */
  _renameEntry(storeKind, from, to) {
    if (!this._canWrite()) return Promise.resolve(t('tabs.elsewhereTitle'))
    const store = this.stores[storeKind]
    clearTimeout(this._saveTimer)
    return this._inTurn(async () => {
      await this._write(true)
      try {
        await store.rename(from, to)
      } catch (err) {
        return err.taken ? t('files.exists', { name: baseName(to) }) : err.message
      }
      const f = this.openFile
      if (f?.store === storeKind && (f.path === from || f.path.startsWith(`${from}/`))) {
        const path = to + f.path.slice(from.length)
        this._moveLayout(f, { ...f, path })
        this._setOpenFile({ ...f, path })
      }
      return null
    })
  }

  async _removeEntry(storeKind, path, kind) {
    if (!this._canWrite()) return
    const ok = await showModal({
      title: t(kind === 'dir' ? 'files.deleteFolderTitle' : 'files.deleteTitle', { name: baseName(path) }),
      bodyHtml: t(kind === 'dir' ? 'files.deleteFolderBodyHtml' : 'files.deleteBodyHtml', { name: baseName(path) }),
      confirmText: t('files.deleteConfirm'),
      cancelText: t('files.cancel'),
    })
    if (!ok) return
    const store = this.stores[storeKind]
    clearTimeout(this._saveTimer)
    // In turn with saves: none waiting can write the open file back after it is gone.
    const gone = await this._inTurn(async () => {
      try {
        await store.remove(path)
      } catch (err) {
        toast({ kind: 'error', title: t('files.deleteFailed', { name: baseName(path) }), detail: err.message })
        return false
      }
      const f = this.openFile
      const open = f?.store === storeKind && (f.path === path || f.path.startsWith(`${path}/`))
      if (open) {
        this._saveFailed = false
        this._setOpenFile(null)
      }
      return open
    })
    if (gone) {
      // The open file went: work on another Python file there, or a new main.py.
      const next = (await store.list('')).find((e) => e.kind === 'file' && /\.py$/i.test(e.name))
      if (next) await this._openRef({ store: storeKind, path: next.path })
      else await this._createEntry(storeKind, await this._freePath(store, '', 'main.py'), 'file')
    }
    await this._renderFiles()
  }

  /**
   * Use a folder on the computer (or the one used before, allowed again).
   * The program open in this browser can be copied into it, to go on there.
   */
  async _attachFolder(again) {
    if (!this._canWrite()) return
    const folder = this.stores.folder
    const name = again ? await folder.reopen() : await folder.pickFolder()
    if (!name) return
    const f = this.openFile
    if (f?.store === 'browser') {
      const file = baseName(f.path)
      const copy = await showModal({
        title: t('files.copyTitle', { file, folder: name }),
        bodyHtml: t('files.copyBodyHtml', { file, folder: name }),
        confirmText: t('files.copyConfirm'),
        cancelText: t('files.copyKeep'),
      })
      if (copy) {
        clearTimeout(this._saveTimer)
        await this._inTurn(async () => {
          await this._write(true)
          const path = await this._freePath(folder, '', file)
          const text = this._currentPython()
          try {
            await folder.write(path, text)
            this._moveLayout(f, { store: 'folder', folder: name, path }, true)
            this._setOpenFile({ store: 'folder', folder: name, path, saved: text })
          } catch (err) {
            toast({ kind: 'error', title: t('files.saveFailed', { file: path }), detail: err.message })
          }
        })
      }
    } else if (f?.store === 'folder' && f.folder === name && this._saveFailed) {
      await this._save(true)
    }
    await this._renderFiles()
  }

  // Each file's blocks, as they were last laid out, kept in this browser
  // while the file's Python is still what they make: a file made in blocks
  // opens again just as it was left.
  _layoutKey(f) {
    return `${f.store}:${f.folder ?? ''}:${f.path}`
  }

  _layouts() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUTS)) || {}
    } catch {
      return {}
    }
  }

  _keepLayouts(all) {
    // The 40 files most recently worked on.
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 40)
    try {
      localStorage.setItem(LAYOUTS, JSON.stringify(Object.fromEntries(kept)))
    } catch {
      // storage full or blocked: files open from their Python instead
    }
  }

  _rememberLayout(f, text) {
    if (this.workspace.mode === 'text' || this.workspace.hasNoBlocks) return
    const all = this._layouts()
    all[this._layoutKey(f)] = { python: text, blocks: Blockly.serialization.workspaces.save(this.workspace.workspace), at: Date.now() }
    this._keepLayouts(all)
  }

  _layoutFor(f, text) {
    const kept = this._layouts()[this._layoutKey(f)]
    return kept && kept.python === text ? kept.blocks : null
  }

  _moveLayout(from, to, copy = false) {
    const all = this._layouts()
    const kept = all[this._layoutKey(from)]
    if (!kept) return
    all[this._layoutKey(to)] = kept
    if (!copy) delete all[this._layoutKey(from)]
    this._keepLayouts(all)
  }

  // -------------------------------------------------------------- menu

  async _menuAction(action) {
    switch (action) {
      case 'open':
        $('file-input').click()
        break
      case 'export-py':
        download('main.py', this._currentPython(), 'text/x-python')
        toast({ kind: 'info', title: t('pySaved.title'), detail: t('pySaved.detail') })
        break
      case 'copy-py':
        try {
          await navigator.clipboard.writeText(this._currentPython())
          toast({ kind: 'info', title: t('pyCopied.title') })
        } catch {
          toast({ kind: 'warn', title: t('pyCopyFailed.title'), detail: t('pyCopyFailed.detail') })
        }
        break
      case 'help':
        showModal({ title: t('help.title'), bodyHtml: t('help.bodyHtml') })
        break
      case 'about':
        showModal({ title: t('about.title'), bodyHtml: t('about.betaHtml') + t('about.bodyHtml') + t('about.privacyHtml') })
        break
      default:
        if (action.startsWith('lang:') && action.slice(5) !== language) setLanguage(action.slice(5))
    }
  }

  /** One item per language in the ⋯ menu, each named in its own language. */
  _renderLanguages() {
    const group = $('lang-menu')
    for (const lang of LANGUAGES) {
      const item = document.createElement('button')
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(lang === language))
      item.dataset.action = `lang:${lang}`
      item.lang = lang
      item.textContent = languageName(lang)
      group.append(item)
    }
  }

  // ------------------------------------------------------------- examples

  /**
   * The Learn panel: a board switch, then that board's quick starts (its two
   * easiest examples) and, folded away, the rest of its examples; then the
   * mission packs kept in this browser, and a button to open a pack file.
   */
  _learnHtml(device, moreOpen, packs) {
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    const name = getTarget(device)?.name || device
    const boards = EXAMPLE_DEVICES.map(
      (id) =>
        `<button type="button" class="ex-board" data-ex-device="${id}" aria-pressed="${id === device}">${esc(getTarget(id)?.name || id)}</button>`,
    ).join('')
    const item = (ex, i) =>
      `<li><button type="button" class="ex-item" data-example="${ex.id}"><span class="ex-num" aria-hidden="true">${i + 1}</span><span class="ex-text"><span class="ex-title">${esc(ex.title)}</span><span class="ex-goal">${esc(ex.goal)}</span></span></button></li>`
    const all = examplesFor(device)
    const quick = all.slice(0, QUICK_STARTS).map(item).join('')
    const more = all.slice(QUICK_STARTS).map((ex, i) => item(ex, QUICK_STARTS + i)).join('')
    return `<h3 class="learn-head">${esc(t('learn.quickTitle'))}</h3>
      <p>${esc(t('learn.quickIntro'))}</p>
      <div class="ex-boards" role="group" aria-label="${esc(t('examples.boards'))}">${boards}</div>
      <ol class="ex-list" aria-label="${esc(t('learn.quickLabel', { device: name }))}">${quick}</ol>
      ${more ? `<details class="ex-more"${moreOpen ? ' open' : ''}><summary>${esc(t('learn.more', { device: name }))}</summary>
      <ol class="ex-list" start="${QUICK_STARTS + 1}" aria-label="${esc(t('examples.listLabel', { device: name }))}">${more}</ol></details>` : ''}
      <h3 class="learn-head learn-packs-head">${esc(t('learn.packsTitle'))}</h3>
      <p>${esc(t('learn.packsIntro'))}</p>
      ${packs.length ? `<ul class="ex-list" aria-label="${esc(t('learn.packsTitle'))}">${packs.map((p) => `<li><button type="button" class="ex-item" data-pack="${esc(p.id)}"><span class="ex-num" aria-hidden="true">📘</span><span class="ex-text"><span class="ex-title">${esc(p.title)}</span><span class="ex-goal">${esc(p.brief)}</span></span></button></li>`).join('')}</ul>` : ''}
      <button type="button" class="btn btn-small btn-quiet learn-open-file" data-pack-file>${esc(t('learn.openFile'))}</button>`
  }

  /**
   * The Learn panel. A picked example opens as a new file beside the open one;
   * a picked pack opens in the tutorial pane.
   */
  async _openLearn() {
    let device = this.workspace.targetId || this.pickedTarget
    if (!EXAMPLE_DEVICES.includes(device)) device = EXAMPLE_DEVICES[0]
    const packs = await this.learn.packs().catch((err) => (console.warn('learn', err), []))
    let chosen = null
    let pack = null
    const closed = showModal({ title: t('learn.title'), bodyHtml: this._learnHtml(device, false, packs), confirmText: t('examples.close') })
    const dialog = $('modal')
    const onClick = (e) => {
      const board = e.target.closest('[data-ex-device]')
      if (board) {
        device = board.dataset.exDevice
        const moreOpen = !!dialog.querySelector('.ex-more')?.open
        dialog.querySelector('.modal-body').innerHTML = this._learnHtml(device, moreOpen, packs)
        dialog.querySelector(`[data-ex-device="${device}"]`).focus()
        return
      }
      const item = e.target.closest('[data-example]')
      if (item) {
        chosen = item.dataset.example
        dialog.close('example')
      }
      const kept = e.target.closest('[data-pack]')
      if (kept) {
        pack = kept.dataset.pack
        dialog.close('pack')
      }
      if (e.target.closest('[data-pack-file]')) {
        // Within the click, so the browser lets the file picker open.
        $('pack-input').click()
        dialog.close('pack-file')
      }
    }
    dialog.addEventListener('click', onClick)
    await closed
    dialog.removeEventListener('click', onClick)
    if (pack) return this.learn.open(pack)
    if (!chosen || !this._canWrite()) return

    const project = exampleProject(device, chosen)
    const goal = t(`example.${device}.${chosen}.goal`)
    if (!(await this._openAsNewFile(project, fileNameFor(project.name, 'py')))) return
    this.pickedTarget = device
    localStorage.setItem(PICKED_DEVICE, device)
    this._renderDevicePicker()
    this._refreshDeviceChip()
    this.terminal.say(t('examples.opened', { name: project.name, goal }))
    toast({ kind: 'info', title: t('opened.title'), detail: goal })
  }

  /**
   * A project of blocks (an example, or an old project file) as a new file,
   * beside the open one, which is saved and kept: named `name`, or name-2 if
   * that is taken, in the store the open file is in.
   */
  async _openAsNewFile(project, name) {
    if (!(await this._leaveFile())) return false
    const ws = this.workspace
    const f = this.openFile
    const kind = f?.store === 'folder' && this.stores.folder?.name === f.folder ? 'folder' : 'browser'
    const store = this.stores[kind]
    const dir = f && f.store === kind ? f.path.split('/').slice(0, -1).join('/') : ''
    const path = await this._freePath(store, dir, name)
    // The new file is the open one before its program goes in, with no wait
    // between: a save waiting its turn writes the new program to the new file,
    // never over the one just left.
    clearTimeout(this._saveTimer)
    this._saveFailed = false
    this._typedBack = null
    this._setOpenFile({ store: kind, folder: kind === 'folder' ? store.name : null, path })
    ws.loadProject({ ...project, name: undefined, mode: undefined, python: undefined })
    ws.workspace.cleanUp()
    if (this.view === 'python') ws.setMode('text', this._blocksPython())
    await this._save(true)
    if (!$('files-panel').hidden) await this._renderFiles()
    return true
  }

  /** ⋯ Open a file: a Python file, or a project file from before files were Python, as a new file. */
  async _importFile(file) {
    if (!file) return
    if (!this._canWrite()) {
      $('file-input').value = ''
      return
    }
    try {
      const text = await file.text()
      if (/\.py$/i.test(file.name)) {
        if (!(await this._leaveFile())) return
        const f = this.openFile
        const kind = f?.store === 'folder' && this.stores.folder?.name === f.folder ? 'folder' : 'browser'
        const path = await this._freePath(this.stores[kind], '', file.name)
        await this.stores[kind].write(path, text)
        await this._openRef({ store: kind, path }, { text, left: true })
      } else {
        const project = JSON.parse(text)
        if (!project?.blocks) throw new Error(t('openFailed.notProject'))
        if (!(await this._openAsNewFile(project, fileNameFor(project.name || file.name.replace(/\.\w+$/, ''), 'py')))) return
        if (project.device) {
          this.pickedTarget = project.device
          localStorage.setItem(PICKED_DEVICE, project.device)
        }
        if (project.mode === 'text' && typeof project.python === 'string') {
          this.workspace.setMode('text', project.python)
          this._fileChanged()
        }
        this._renderDevicePicker()
        this._refreshDeviceChip()
      }
      if (!$('files-panel').hidden) await this._renderFiles()
      toast({ kind: 'info', title: t('opened.title') })
    } catch (err) {
      toast({ kind: 'error', title: t('openFailed.title'), detail: err.message })
    } finally {
      $('file-input').value = ''
    }
  }

  // ------------------------------------------------------------- first run

  _checkBrowser() {
    if (this.device.supported) return
    $('browser-note').textContent = t('browser.note')
    $('btn-connect').disabled = true
    this.terminal.warn(`${t('browser.noSerial')}\r\n${t('browser.noSerialHintSim')}`)
  }

  _maybeWelcome() {
    if (localStorage.getItem(SEEN_WELCOME)) return
    localStorage.setItem(SEEN_WELCOME, '1')
    showModal({ title: t('welcome.title'), bodyHtml: t('welcome.bodyHtml'), confirmText: t('welcome.confirm') })
  }
}

/** Boards' names as a list: "CodeX and CodeAIR". */
function deviceNames(ids) {
  return listOf(ids.map((id) => getTarget(id)?.name))
}

function download(filename, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const KNOWN_ERRORS = ['NameError', 'SyntaxError', 'TypeError', 'ValueError', 'ZeroDivisionError', 'MemoryError', 'ImportError', 'OSError']

function friendlyErrorTitle(name) {
  return KNOWN_ERRORS.includes(name) ? t(`pyerr.${name}`) : t('pyerr.other', { name })
}
