/**
 * A journey step's named places (docs/mission-packs.md, "Journeys"), found in
 * the app as it is now: the box on the page, and the element, if one, that a
 * student would press. Authors name places, never selectors, so the app can
 * change its markup without breaking a pack:
 *
 *   run, stop, pause, step, switch, sim,     the app's own controls (step
 *   terminal                                 shows once a run is paused)
 *   program                                  the student's blocks, all of them
 *   palette:lights                           a palette category, by its id
 *   palette-item:pixels.fill(...)            the block in the open category whose code matches
 *   block:display.show(...)                  the student's block whose code matches
 *   field:display.show(...)                  that block's first text or number field
 *   after:display.show(...)                  just under that block, where the next one goes
 *   part:^Neo_0$                             a part of the simulated board, by its CAD name
 *
 * A place that is not on screen now (a closed category, a block not yet
 * made) resolves to null, and the coach falls back to the step's words.
 *
 * The same places work in Python, so a step is written once: there `palette:`
 * is the Python palette's category, `palette-item:` its card, `block:` the
 * editor's line whose statement matches, `field:` the first string or number
 * in it, and `after:` the line under it.
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

/** The places that are the editor's or the Python palette's in Python. */
const PY_KINDS = new Set(['palette', 'palette-item', 'block', 'field', 'after', 'program'])
/** A string or a number in a line of Python: what `field:` points at there. */
const LITERAL = /(["'])(?:\\.|(?!\1).)*\1|(?<![\w.])\d+(?:\.\d+)?\b/

/** Is a box's middle inside an area (none: not on screen)? */
function within(box, area) {
  if (!area) return false
  const x = box.x + box.w / 2
  const y = box.y + Math.min(box.h, 40) / 2
  return x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h
}

/** The smallest box holding every box (null for none). */
function union(boxes) {
  if (!boxes.length) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}

/** The part of a box inside an area (null when none of it is). */
function clip(box, area) {
  if (!box) return null
  const x = Math.max(box.x, area.x)
  const y = Math.max(box.y, area.y)
  const w = Math.min(box.x + box.w, area.x + area.w) - x
  const h = Math.min(box.y + box.h, area.y + area.h) - y
  return w > 0 && h > 0 ? { x, y, w, h } : null
}

export class Places {
  /**
   * `blocks`, the app's BlockWorkspace; `sim()`, the simulator's view while
   * it is open (for its canvas and `partBox`), else null; `python()`, while
   * the Python view is on show, { editor, palette } (the LazyPythonEditor and
   * the SnippetPalette), else null.
   */
  constructor({ blocks, sim, python = () => null }) {
    this.blocks = blocks
    this.sim = sim
    this.python = python
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
      let el = document.querySelector(CONTROLS[kind])
      // Run is hidden while a program runs, Stop in its place: pressed first, so it is pointed at.
      if (kind === 'run' && el?.hidden) el = document.querySelector(CONTROLS.stop)
      const box = boxOf(el)
      return box && { box, el }
    }
    const py = this.python()
    if (py && PY_KINDS.has(kind)) return this._inPython(py, kind, arg)
    switch (kind) {
      case 'program': {
        // Every block of the program, as one box, within the blocks area.
        const area = boxOf(this.workspace.getParentSvg?.())
        const boxes = this.workspace.getTopBlocks(false).map((b) => boxOf(b.getSvgRoot())).filter(Boolean)
        const box = area && clip(union(boxes), area)
        return box && { box, el: this.workspace.getParentSvg(), side: 'right' }
      }
      case 'sim': {
        const el = this.sim()?.renderer?.domElement
        const box = boxOf(el)
        // To its left, pointing in, clear of its buttons and the terminal under it.
        return box && { box, el, side: 'left' }
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
        // Scrolled out of the blocks area, it is not on screen (reveal brings it back).
        if (!within(own, boxOf(this.workspace.getParentSvg?.()))) return null
        if (kind === 'block') return { box: own, el: svg, block }
        if (kind === 'after') return { box: { x: own.x, y: own.y + own.h - 4, w: Math.max(own.w, 160), h: Math.max(own.h, 36) }, el: null, block }
        // The block's own text field, or one in a block plugged into it (a text value is a block of its own).
        const field = block.getDescendants(false).flatMap((b) => b.inputList.flatMap((i) => i.fieldRow)).find((f) => (f instanceof Blockly.FieldTextInput || f instanceof Blockly.FieldNumber) && f.isVisible())
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

  /** A place in the Python view: the palette's category or card, or the editor's line, literal or the line under it. */
  _inPython({ editor, palette }, kind, arg) {
    if (kind === 'palette') {
      const el = palette.root?.querySelector(`.py-cat[data-id="${CSS.escape(arg)}"]`)
      const box = boxOf(el)
      return box && { box, el }
    }
    if (kind === 'palette-item') {
      const cat = palette.categories?.[palette.open]
      if (!cat?.snippets) return null
      const j = cat.snippets.findIndex((s) => find(s.code, arg).length)
      const el = j >= 0 ? palette.root?.querySelector(`.py-snippets .snippet[data-j="${j}"]`) : null
      const box = boxOf(el)
      return box && within(box, boxOf(el.closest('.py-flyout'))) ? { box, el } : null
    }
    const view = editor.view
    if (kind === 'program') {
      // The program's lines, as one box, within the editor.
      const doc = view?.state.doc
      const first = doc && view.coordsAtPos(0)
      const last = doc && view.coordsAtPos(doc.length)
      const area = view && boxOf(view.scrollDOM)
      if (!first || !last || !area) return null
      let right = first.right
      for (let n = 1; n <= doc.lines; n++) right = Math.max(right, view.coordsAtPos(doc.line(n).to)?.right ?? 0)
      const box = clip({ x: first.left, y: first.top, w: right - first.left, h: last.bottom - first.top }, area)
      return box && { box, el: view.contentDOM, side: 'right' }
    }
    const at = view && this._pyStatement(view, arg)
    if (!at) return null
    const doc = view.state.doc
    const row = doc.lineAt(at.from)
    const indent = row.text.length - row.text.trimStart().length
    const start = view.coordsAtPos(row.from + indent)
    const end = view.coordsAtPos(row.to)
    if (!start || !end) return null
    const own = { x: start.left, y: start.top, w: Math.max(end.right - start.left, 40), h: start.bottom - start.top }
    if (!within(own, boxOf(view.scrollDOM))) return null
    // The bubble goes to the right of a line, so the lines around it stay in sight.
    // Clear of the lines around it too: past the widest of the six above and below.
    let right = own.x + own.w
    for (let n = Math.max(1, row.number - 6); n <= Math.min(doc.lines, row.number + 6); n++) right = Math.max(right, view.coordsAtPos(doc.line(n).to)?.right ?? 0)
    const beside = { ...own, w: right - own.x }
    const line = (box) => ({ box, el: view.contentDOM, side: 'right', beside })
    if (kind === 'block') return line(own)
    if (kind === 'after') return { ...line({ x: own.x, y: own.y + own.h, w: Math.max(own.w, 160), h: own.h }), el: null }
    // field: the first string or number in the statement.
    const m = LITERAL.exec(doc.sliceString(at.from, at.to))
    if (!m) return line(own)
    const a = view.coordsAtPos(at.from + m.index)
    const b = view.coordsAtPos(at.from + m.index + m[0].length)
    return a && b ? line({ x: a.left, y: a.top, w: Math.max(b.right - a.left, 12), h: a.bottom - a.top }) : line(own)
  }

  /** The first statement of the editor's text matching a pattern: { from, to }, or null. */
  _pyStatement(view, pattern) {
    const [node] = find(view.state.doc.toString(), pattern)
    return node ? { from: node.from, to: node.to } : null
  }

  /** Bring a place into view where the controller can: the student's block, scrolled to the middle of the blocks area. */
  reveal(place) {
    const [kind, arg] = (place || '').split(/:(.*)/s)
    if (!['block', 'field', 'after'].includes(kind) || this.resolve(place)) return
    const py = this.python()
    if (py) {
      // The editor scrolls the line to its middle.
      const view = py.editor.view
      const at = view && this._pyStatement(view, arg)
      if (at) view.dispatch({ effects: view.constructor.scrollIntoView(at.from, { y: 'center' }) })
      return
    }
    const block = this.programBlock(arg)
    if (block && boxOf(this.workspace.getParentSvg?.())) this.workspace.centerOnBlock?.(block.id)
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
    const py = this.python()
    if (py) {
      const i = py.palette.categories?.findIndex((c) => c.id === id) ?? -1
      if (i >= 0 && py.palette.open !== i) py.palette.show(i)
      return
    }
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
    // The first match a block made: blocks declare their variables first (`delay = None`), on lines no block owns.
    for (const node of find(code, pattern)) {
      const id = blockAt[lineAt(code, node.from)]
      const block = id && this.workspace.getBlockById(id)
      if (block) return block
    }
    return null
  }
}

