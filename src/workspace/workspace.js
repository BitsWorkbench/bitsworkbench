/**
 * The Blockly workspace: injection, per-device toolbox swapping, and keeping
 * the student's work safe in localStorage between visits.
 */
import * as Blockly from 'blockly/core'
import { toolboxFor, cuteTheme, generatePython } from '../blocks/index.js'
import { t } from '../i18n/index.js'

const STORAGE_KEY = 'opencodebot.project.v1'
export const DEFAULT_PROJECT_NAME = t('project.default')

/** Space between stacks lined up below the others (workspace units). */
const PLACE_GAP = 48

/** What a stack or note on the canvas is, for keeping its place: its kind, and a function's name or a note's text. */
function placeKey(item) {
  if (item instanceof Blockly.BlockSvg) return `${item.type}:${item.getField('NAME') ? item.getFieldValue('NAME') : ''}`
  return `note:${item.getText()}`
}

/** Tidy a project name: one line, no runs of spaces, never empty. */
export function cleanProjectName(name) {
  const tidy = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return tidy || DEFAULT_PROJECT_NAME
}

/** A file name made from a project name, safe on every operating system. */
export function fileNameFor(name, extension) {
  const base = cleanProjectName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'project'}.${extension}`
}

export class BlockWorkspace extends EventTarget {
  constructor(container, targetId = null) {
    super()
    this.targetId = targetId
    this.name = DEFAULT_PROJECT_NAME
    /** 'blocks', or 'text' once the student starts typing Python. */
    this.mode = 'blocks'
    /** The typed program, used only in text mode. */
    this.pythonText = ''
    this.workspace = Blockly.inject(container, {
      toolbox: toolboxFor(targetId),
      theme: cuteTheme,
      renderer: 'zelos',
      trashcan: true,
      sounds: false,
      // Bundled locally so the editor still works with no internet.
      media: './blockly-media/',
      grid: { spacing: 28, length: 3, colour: '#ece9e1', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 2, scaleSpeed: 1.1 },
      move: { scrollbars: true, drag: true, wheel: true },
    })

    this.workspace.addChangeListener((event) => {
      if (event.isUiEvent) return
      this.dispatchEvent(new CustomEvent('change'))
    })
  }

  resize() {
    Blockly.svgResize(this.workspace)
  }

  /** No blocks on the canvas. */
  get hasNoBlocks() {
    return this.workspace.getTopBlocks(false).length === 0
  }

  /**
   * Nothing to lose: no blocks and no typed Python. Everything that would
   * replace or clear the project checks this, so typed code counts as work.
   */
  get isEmpty() {
    return this.hasNoBlocks && !(this.mode === 'text' && this.pythonText.trim())
  }

  /** The canvas holds its board's starter program as it came: nothing of the student's yet. */
  get isStarter() {
    const starter = STARTER_PROJECTS[this.targetId]
    if (this.mode === 'text' || !starter) return false
    const scratch = new Blockly.Workspace()
    try {
      Blockly.serialization.workspaces.load(starter.blocks, scratch)
      return generatePython(scratch, this.targetId) === generatePython(this.workspace, this.targetId)
    } finally {
      scratch.dispose()
    }
  }

  /** Swap the toolbox when the teacher (or a plugged-in board) picks a device. */
  setTarget(targetId) {
    if (targetId === this.targetId) return
    this.targetId = targetId
    this.workspace.updateToolbox(toolboxFor(targetId))
    this.dispatchEvent(new CustomEvent('change'))
  }

  clear() {
    this.workspace.clear()
    this.setMode('blocks')
    this.dispatchEvent(new CustomEvent('replace'))
    this.dispatchEvent(new CustomEvent('change'))
  }

  /**
   * The same project's program, as new blocks (typed Python turned back into
   * blocks): the stacks are laid out in a column, in program order.
   */
  replaceBlocks(state) {
    const before = this._places()
    Blockly.serialization.workspaces.load(state, this.workspace)
    this._keepPlaces(before, state)
    this.workspace.scrollCenter()
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** The stacks and notes on the canvas, top to bottom. */
  _tops() {
    const notes = (this.workspace.getTopComments?.() || []).sort(
      (a, b) => a.getRelativeToSurfaceXY().y - b.getRelativeToSurfaceXY().y,
    )
    return [...this.workspace.getTopBlocks(true), ...notes]
  }

  /** Where each stack and note stands, by what it is (placeKey). */
  _places() {
    const places = new Map()
    for (const item of this._tops()) {
      const key = placeKey(item)
      if (!places.has(key)) places.set(key, [])
      places.get(key).push(item.getRelativeToSurfaceXY())
    }
    return places
  }

  /**
   * Stacks and notes that were on the canvas before (the "on start" stack,
   * "forever", a function by its name, a note by its text) keep their
   * places, and new ones line up below them. The blocks' Python follows
   * their order top to bottom, so when the old places would change that
   * order, or nothing was there before, the canvas is tidied instead.
   */
  _keepPlaces(before, state) {
    const tops = this._tops()
    const fresh = []
    const kept = []
    for (const item of tops) {
      const at = before.get(placeKey(item))?.shift()
      if (!at) {
        fresh.push(item)
        continue
      }
      item.moveTo(new Blockly.utils.Coordinate(at.x, at.y))
      kept.push(item)
    }
    if (!kept.length) return this.workspace.cleanUp()
    // Sizes are known once Blockly has drawn the new blocks.
    Blockly.renderManagement.triggerQueuedRenders(this.workspace)
    const left = Math.min(...kept.map((item) => item.getBoundingRectangle().left))
    let bottom = Math.max(...kept.map((item) => item.getBoundingRectangle().bottom))
    for (const item of fresh) {
      item.moveTo(new Blockly.utils.Coordinate(left, bottom + PLACE_GAP))
      bottom = item.getBoundingRectangle().bottom
    }
    const wanted = [
      ...(state.blocks?.blocks || []).map((b) => `${b.type}:${b.fields?.NAME ?? ''}`),
      ...(state.workspaceComments || []).map((c) => `note:${c.text}`),
    ]
    if (this._tops().map(placeKey).join('\n') !== wanted.join('\n')) {
      // Back to the order the state has, then tidied.
      Blockly.serialization.workspaces.load(state, this.workspace)
      this.workspace.cleanUp()
    }
  }

  /** Switch between blocks and typed Python. `text` seeds text mode. */
  setMode(mode, text = this.pythonText) {
    const next = mode === 'text' ? 'text' : 'blocks'
    const nextText = next === 'text' ? text : ''
    if (next === this.mode && nextText === this.pythonText) return
    this.mode = next
    this.pythonText = nextText
    this.dispatchEvent(new CustomEvent('mode'))
    this.dispatchEvent(new CustomEvent('change'))
  }

  setPythonText(text) {
    if (this.mode !== 'text' || text === this.pythonText) return
    this.pythonText = text
    this.dispatchEvent(new CustomEvent('change'))
  }

  rename(name) {
    const next = cleanProjectName(name)
    if (next === this.name) return
    this.name = next
    // The name is the open file's (the app sets it); the program is unchanged.
    this.dispatchEvent(new CustomEvent('rename'))
  }

  /** A project is the blocks plus the board they were written for. */
  toProject() {
    return {
      format: 'opencodebot',
      version: 1,
      name: this.name,
      device: this.targetId,
      blocks: Blockly.serialization.workspaces.save(this.workspace),
      ...(this.mode === 'text' ? { mode: 'text', python: this.pythonText } : {}),
    }
  }

  loadProject(project) {
    if (!project?.blocks) throw new Error(t('openFailed.notProject'))
    if (project.device) this.setTarget(project.device)
    // Starter programs carry no name; keep whatever the student called it.
    if (project.name) this.name = cleanProjectName(project.name)
    this.dispatchEvent(new CustomEvent('rename'))
    Blockly.serialization.workspaces.load(project.blocks, this.workspace)
    this.setMode(project.mode, typeof project.python === 'string' ? project.python : '')
    // Another project in place of this one (a file the app had open is no longer it).
    this.dispatchEvent(new CustomEvent('replace'))
    this.dispatchEvent(new CustomEvent('change'))
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toProject()))
    } catch {
      // Private browsing, or a full quota — not worth interrupting a lesson.
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      this.loadProject(JSON.parse(raw))
      return true
    } catch {
      return false
    }
  }

  /** Flash a block red, e.g. when a program throws. */
  highlight(blockId) {
    this.workspace.highlightBlock(blockId || null)
  }
}

export const STARTER_PROJECTS = {
  codex: {
    device: 'codex',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codex_show',
                  inputs: { THING: { shadow: { type: 'text', fields: { TEXT: t('starter.hello') } } } },
                  next: {
                    block: {
                      type: 'codex_pixels_fill',
                      fields: { BRIGHT: 40 },
                      inputs: { COLOR: { shadow: { type: 'ocb_color', fields: { COLOR: 'PINK' } } } },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  codebot: {
    device: 'codebot',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codebot_drive_for',
                  fields: { DIR: 'forward' },
                  inputs: {
                    POWER: { shadow: { type: 'math_number', fields: { NUM: 50 } } },
                    SECS: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
                  },
                  next: { block: { type: 'codebot_leds_all', fields: { ON: '0xFF' } } },
                },
              },
            },
          },
        ],
      },
    },
  },
  codeair: {
    device: 'codeair',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codeair_safe_flight',
                  inputs: {
                    DO: {
                      block: {
                        type: 'codeair_take_off',
                        fields: { HEIGHT: 0.4 },
                        next: {
                          block: {
                            type: 'codeair_hover',
                            inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 2 } } } },
                            next: { block: { type: 'codeair_land' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
}
