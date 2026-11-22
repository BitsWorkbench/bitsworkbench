/**
 * A journey step's named places (docs/mission-packs.md, "Journeys"), found in
 * the app as it is now: the box on the page, and the element, if one, that a
 * student would press. Authors name places, never selectors, so the app can
 * change its markup without breaking a pack:
 *
 *   run, stop, pause, step, switch, sim,     the app's own controls (step
 *   terminal                                 shows once a run is paused)
 *   palette:lights                           a palette category, by its id
 *   palette-item:pixels.fill(...)            the block in the open category whose code matches
 *   block:display.show(...)                  the student's block whose code matches
 *   field:display.show(...)                  that block's first text or number field
 *   after:display.show(...)                  just under that block, where the next one goes
 *   part:^Neo_0$                             a part of the simulated board, by its CAD name
 *
 * A place that is not on screen now (a closed category, a block not yet
 * made) resolves to null, and the coach falls back to the step's words.
 */
import * as Blockly from 'blockly/core'
import { generatePython, generateWithLines } from '../../blocks/generate.js'
import { lineAt } from '../../convert/tree.js'
import { find } from '../checks.js'

const CONTROLS = { run: '#btn-run', stop: '#btn-stop', pause: '#btn-pause', step: '#btn-step', switch: '#btn-view', terminal: '#panel-terminal' }

/** A DOMRect-like box, or null when the element is missing or hidden. */
function boxOf(el) {
  if (!el || el.hidden || !el.isConnected) return null
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
}

export class Places {
  /**
   * `blocks`, the app's BlockWorkspace; `sim()`, the simulator's view while
   * it is open (for its canvas and `partBox`), else null.
   */
  constructor({ blocks, sim }) {
    this.blocks = blocks
    this.sim = sim
    this.pythonOf = new WeakMap() // flyout block: its code, made once
  }

  get workspace() {
    return this.blocks.workspace
  }

  /** { box, el } for a place, or null when it is not on screen. */
  resolve(place) {
    if (!place) return null
    const [kind, arg] = place.split(/:(.*)/s)
    if (CONTROLS[kind]) {
      const el = document.querySelector(CONTROLS[kind])
      const box = boxOf(el)
      return box && { box, el }
    }
    switch (kind) {
      case 'sim': {
        const el = this.sim()?.renderer?.domElement
        const box = boxOf(el)
        return box && { box, el }
      }
      case 'palette': {
        const item = this.workspace.getToolbox()?.getToolboxItemById(arg)
        const el = item?.getDiv?.()?.querySelector('.blocklyToolboxCategory, .blocklyTreeRow') || item?.getDiv?.()
        const box = item?.isVisible?.() !== false ? boxOf(el) : null
        return box && { box, el }
      }
      case 'palette-item': {
        const block = this.flyoutBlock(arg)
        const box = block && boxOf(block.getSvgRoot())
        return box && { box, el: block.getSvgRoot(), block }
      }
      case 'block':
      case 'field':
      case 'after': {
        const block = this.programBlock(arg)
        if (!block) return null
        const svg = block.getSvgRoot()
        const whole = boxOf(svg)
        if (!whole) return null
        // The block's own row, not the blocks inside it or after it.
        const own = { ...whole, h: Math.min(whole.h, block.height * this.workspace.scale || whole.h) }
        if (kind === 'block') return { box: own, el: svg, block }
        if (kind === 'after') return { box: { x: own.x, y: own.y + own.h - 4, w: Math.max(own.w, 160), h: Math.max(own.h, 36) }, el: null, block }
        // The block's own text field, or one in a block plugged into it (a text value is a block of its own).
        const field = block.getDescendants(false).flatMap((b) => b.inputList.flatMap((i) => i.fieldRow)).find((f) => f instanceof Blockly.FieldTextInput && f.isVisible())
        const fbox = field && boxOf(field.getSvgRoot())
        return fbox && { box: fbox, el: field.getSvgRoot(), block, field }
      }
      case 'part': {
        const view = this.sim()
        const box = view?.partBox?.(new RegExp(arg))
        return box && { box, el: view.renderer?.domElement }
      }
      default:
        return null
    }
  }

  /** Every box a place names: each part on its own for `part:`, else the one box (or none). */
  boxes(place) {
    if (place?.startsWith('part:')) return this.sim()?.partBoxes?.(new RegExp(place.slice(5))) ?? []
    const found = this.resolve(place)
    return found ? [found.box] : []
  }

  /** The student's statement blocks, in program order (one per line of code). */
  programBlocks() {
    const { blockAt } = generateWithLines(this.workspace, this.blocks.targetId)
    const seen = new Set()
    return Object.keys(blockAt).map(Number).sort((a, b) => a - b).map((n) => blockAt[n])
      .filter((id) => id && !seen.has(id) && seen.add(id)).map((id) => this.workspace.getBlockById(id)).filter(Boolean)
  }

  /** The student's program as Python, the same in either mode. */
  programText() {
    return generatePython(this.workspace, this.blocks.targetId)
  }

  /** Open a palette category (a step pointing into it, after a click elsewhere closed it). */
  openPalette(id) {
    const toolbox = this.workspace.getToolbox()
    const item = toolbox?.getToolboxItemById(id)
    if (item && toolbox.getSelectedItem() !== item) toolbox.setSelectedItem(item)
  }

  /** The block in the palette's open flyout whose code matches a pattern. */
  flyoutBlock(pattern) {
    const flyout = this.workspace.getFlyout?.()
    if (!flyout?.isVisible?.()) return null
    for (const block of flyout.getWorkspace().getTopBlocks(true)) {
      if (!this.pythonOf.has(block)) this.pythonOf.set(block, this._python(block))
      if (find(this.pythonOf.get(block), pattern).length) return block
    }
    return null
  }

  /** One block's code, made on a scratch workspace, with the imports it needs. */
  _python(block) {
    const scratch = new Blockly.Workspace()
    try {
      Blockly.serialization.blocks.append(Blockly.serialization.blocks.save(block), scratch)
      return generatePython(scratch, this.blocks.targetId)
    } catch {
      return ''
    } finally {
      scratch.dispose()
    }
  }

  /** The student's block whose statement matches a pattern: the first one, in program order. */
  programBlock(pattern) {
    const { code, blockAt } = generateWithLines(this.workspace, this.blocks.targetId)
    const node = find(code, pattern)[0]
    if (!node) return null
    const id = blockAt[lineAt(code, node.from)]
    return (id && this.workspace.getBlockById(id)) || null
  }
}

