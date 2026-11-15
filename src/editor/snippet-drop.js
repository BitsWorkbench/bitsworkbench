/**
 * Snippets from the palette, into the editor: where a dragged one would land,
 * and the one change that puts it there with the imports and setup it needs,
 * so a single undo takes it all back out.
 *
 * A statement snippet goes between lines. The pointer's height picks the gap;
 * the dragged card's left edge picks how deep it is indented, within what
 * Python allows there (under a line ending in a colon it must go in the body;
 * after a body it may stay in it or come out). Dropped on a blank line, it
 * fills that line. A value snippet goes inside a line, where the card's left
 * edge points.
 *
 * The dragged card itself floats over the code, showing the snippet's shape;
 * the editor marks only where it would land, on a layer over the text, so
 * the text never moves under the pointer while it is dragged.
 */
import { EditorView, layer } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'

const INDENT = 4

// ------------------------------------------------------------ the preview

/** The place a dragged snippet would land, with its colour; null for none. */
const setPreview = StateEffect.define()

const preview = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPreview)) return e.value
    return tr.docChanged ? null : value
  },
})

/** A coloured mark at a point in the scroller: a gap bar, a blank line's box, or a caret. */
class Mark {
  constructor(className, left, top, width, height, colour) {
    Object.assign(this, { className, left, top, width, height, colour })
  }
  eq(o) {
    return ['className', 'left', 'top', 'width', 'height', 'colour'].every((k) => o[k] === this[k])
  }
  draw() {
    const el = document.createElement('div')
    this.update(el)
    return el
  }
  update(el) {
    el.className = this.className
    Object.assign(el.style, { left: `${this.left}px`, top: `${this.top}px`, width: `${this.width}px`, height: `${this.height}px` })
    el.style.setProperty('--c', this.colour)
    return true
  }
}

const marks = layer({
  above: true,
  class: 'cm-snippet-marks',
  update: (u) => u.docChanged || u.geometryChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(setPreview))),
  markers(view) {
    const p = view.state.field(preview)
    if (!p) return []
    const base = view.scrollDOM.getBoundingClientRect()
    const ox = base.left - view.scrollDOM.scrollLeft
    const oy = base.top - view.scrollDOM.scrollTop
    const right = view.contentDOM.getBoundingClientRect().right - ox
    const { doc } = view.state
    if (!p.line) {
      const c = view.coordsAtPos(p.pos)
      return c ? [new Mark('cm-snippet-caret', c.left - ox - 1, c.top - oy, 3, c.bottom - c.top, p.colour)] : []
    }
    const textLeft = view.coordsAtPos(doc.line(Math.min(p.n, doc.lines)).from)?.left ?? base.left
    const left = textLeft - ox + p.indent * view.defaultCharacterWidth
    if (p.fill) {
      const line = view.lineBlockAt(doc.line(p.n).from)
      return [new Mark('cm-snippet-slot', left, line.top + view.documentTop - oy, right - left, line.height, p.colour)]
    }
    const y = p.n > doc.lines ? view.lineBlockAt(doc.length).bottom : view.lineBlockAt(doc.line(p.n).from).top
    return [new Mark('cm-snippet-gap', left, y + view.documentTop - oy - 2, right - left, 4, p.colour)]
  },
})

export const snippetDrop = [preview, marks]

// --------------------------------------------------------- where it goes

const indentOf = (text) => text.match(/^ */)[0].length
const isBlank = (text) => !text.trim()
/** Ends with a colon, ignoring a trailing comment. */
const opensBlock = (text) => /:\s*(#.*)?$/.test(text)

/** The indents Python allows for a new line just before line `n` (1-based; lines + 1 for the end). */
function allowedIndents(doc, n) {
  let prev = null
  for (let i = n - 1; i >= 1; i--) if (!isBlank(doc.line(i).text)) { prev = doc.line(i).text; break }
  let next = null
  for (let i = n; i <= doc.lines; i++) if (!isBlank(doc.line(i).text)) { next = doc.line(i).text; break }
  if (prev === null) return { min: 0, max: 0 }
  if (opensBlock(prev)) {
    const body = indentOf(prev) + INDENT
    return { min: body, max: body }
  }
  const max = indentOf(prev)
  const min = next === null ? 0 : Math.min(indentOf(next), max)
  return { min, max }
}

/**
 * Where a snippet would land with its left edge at (x, y), or null when the
 * point is not over the editor's text.
 * Statement: { line: true, n, fill, indent }, before line n (fill: replace
 * blank line n). Value: { line: false, pos }.
 */
function placeAt(view, snippet, x, y) {
  const box = view.scrollDOM.getBoundingClientRect()
  if (x < box.left - 40 || x > box.right || y < box.top || y > box.bottom) return null
  const { doc } = view.state
  const pos = view.posAtCoords({ x: Math.max(x, view.contentDOM.getBoundingClientRect().left), y }, false)
  if (!snippet.line) return { line: false, pos }
  const line = doc.lineAt(pos)
  const block = view.lineBlockAt(line.from)
  const top = view.documentTop + block.top
  let n
  let fill = false
  if (isBlank(line.text)) {
    n = line.number
    fill = true
  } else {
    n = y > top + block.height / 2 ? line.number + 1 : line.number
  }
  // Indent from the card's left edge, in whole levels, within what is allowed.
  const left = view.coordsAtPos(line.from)?.left ?? box.left
  const col = Math.max(0, (x - left) / view.defaultCharacterWidth)
  const wanted = Math.round(col / INDENT) * INDENT
  const { min, max } = allowedIndents(doc, n)
  const indent = Math.min(max, Math.max(min, wanted))
  return { line: true, n, fill, indent }
}

// ------------------------------------------------------------ the change

/** The snippet's code, every line indented by `indent` spaces. */
function indented(code, indent) {
  const pad = ' '.repeat(indent)
  return code
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n')
}

/** The imports and setup the snippet needs that the program lacks: changes near the top. */
function requirements(doc, snippet) {
  const has = new Set()
  let firstImport = 0
  let lastImport = 0
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text
    has.add(text.trim())
    if (/^(import|from)\s/.test(text)) {
      if (!firstImport) firstImport = i
      lastImport = i
    }
  }
  const changes = []
  const imports = (snippet.imports || []).filter((l) => !has.has(l))
  const setup = (snippet.setup || []).filter((l) => !has.has(l))
  // Radio reserves memory, so its import comes before every other.
  const first = imports.filter((l) => l === 'import radio')
  const after = [...imports.filter((l) => l !== 'import radio'), ...setup]
  if (first.length) {
    const at = firstImport ? doc.line(firstImport).from : 0
    changes.push({ from: at, insert: first.map((l) => l + '\n').join('') })
  }
  if (after.length) {
    if (lastImport) {
      changes.push({ from: doc.line(lastImport).to, insert: after.map((l) => '\n' + l).join('') })
    } else {
      // No imports yet: before the first line of code (after any opening comments).
      let i = 1
      while (i <= doc.lines && (isBlank(doc.line(i).text) || doc.line(i).text.startsWith('#'))) i++
      const at = i <= doc.lines ? doc.line(i).from : doc.length
      const text = after.join('\n')
      changes.push({ from: at, insert: at === doc.length && doc.length ? '\n' + text + '\n' : text + '\n' })
    }
  }
  return changes
}

/** One transaction: the snippet at `place`, plus what it needs, with `pass` selected. */
function transactionFor(state, snippet, place) {
  const { doc } = state
  let main
  if (!place.line) {
    main = { from: place.pos, to: place.pos, insert: snippet.code }
  } else {
    const code = indented(snippet.code, place.indent)
    if (place.fill) {
      const line = doc.line(place.n)
      main = { from: line.from, to: line.to, insert: code }
    } else if (place.n > doc.lines) {
      const end = doc.length
      main = { from: end, to: end, insert: (doc.line(doc.lines).length ? '\n' : '') + code }
    } else {
      const at = doc.line(place.n).from
      main = { from: at, to: at, insert: code + '\n' }
    }
  }
  const extra = requirements(doc, snippet)
  // The main change's text starts where it starts, moved on by the requirements before it.
  const before = extra.filter((c) => c.from <= main.from).reduce((n, c) => n + c.insert.length, 0)
  // Past the line break and indent the inserted text begins with.
  const lead = main.insert.length - main.insert.trimStart().length
  const start = main.from + before + lead
  const body = main.insert.trimStart()
  const passAt = body.indexOf('pass')
  const selection =
    passAt >= 0 ? { anchor: start + passAt, head: start + passAt + 4 } : { anchor: start + body.trimEnd().length }
  return {
    changes: [...extra, main],
    selection,
    effects: [setPreview.of(null), EditorView.scrollIntoView(selection.anchor, { y: 'nearest' })],
    userEvent: 'input.snippet',
  }
}

// ------------------------------------------------------------ the surface

export function previewSnippet(view, snippet, x, y) {
  const place = snippet && placeAt(view, snippet, x, y)
  const now = view.state.field(preview)
  if (!place) {
    if (now) view.dispatch({ effects: setPreview.of(null) })
    return
  }
  const next = { ...place, colour: snippet.colour }
  if (now && JSON.stringify(now) === JSON.stringify(next)) return
  view.dispatch({ effects: setPreview.of(next) })
}

export function dropSnippet(view, snippet, x, y) {
  const place = placeAt(view, snippet, x, y)
  if (!place) {
    previewSnippet(view, null)
    return false
  }
  view.dispatch(transactionFor(view.state, snippet, place))
  view.focus()
  return true
}

/** At the cursor: a statement goes on a new line under the cursor's line (or fills it, if blank). */
export function insertSnippet(view, snippet) {
  const { state } = view
  const { doc } = state
  const sel = state.selection.main
  if (!snippet.line) {
    // A value replaces the selection.
    const tr = transactionFor(state, snippet, { line: false, pos: sel.from })
    tr.changes[tr.changes.length - 1].to = sel.to
    view.dispatch(tr)
  } else {
    const line = doc.lineAt(sel.head)
    const fill = isBlank(line.text)
    const n = fill ? line.number : line.number + 1
    const { min, max } = allowedIndents(doc, n)
    // As deep as the cursor's line, or into the body when that line opens one.
    const indent = Math.min(max, Math.max(min, indentOf(line.text)))
    view.dispatch(transactionFor(state, snippet, { line: true, n, fill, indent }))
  }
  view.focus()
}
