/**
 * The Python editor, loaded when it is first needed: CodeMirror is a large
 * part of the app and a student starting in blocks may never open Python.
 * The app talks to this as it would to PythonEditor (value, focus, the
 * paused line, snippets); `load()` brings the real editor in.
 *
 * Nothing a student types is lost while it loads: until CodeMirror is there
 * the pane holds a plain text box with the program in it, which takes
 * typing, and the editor starts from what that box holds, with the same
 * selection, and takes the focus if the box had it. If CodeMirror cannot
 * load (offline, before the app was kept for offline use), the box stays
 * and is the editor.
 */
export class LazyPythonEditor {
  /** The same options as PythonEditor's. */
  constructor(parent, options) {
    this.parent = parent
    this.options = options
    this.editor = null // the PythonEditor, once loaded
    this._text = ''
    this._line = null // a line to show once loaded
    this._loading = null
    this.box = null
  }

  /** Whether CodeMirror is in. */
  get loaded() {
    return !!this.editor
  }

  /** The CodeMirror view, once loaded (tests reach it). */
  get view() {
    return this.editor?.view
  }

  get value() {
    if (this.editor) return this.editor.value
    return this.box ? this.box.value : this._text
  }

  set value(text) {
    if (this.editor) {
      this.editor.value = text
      return
    }
    if (text === this.value) return
    this._text = text
    this._line = null
    if (this.box) {
      this.box.value = text
      this.box.setSelectionRange(text.length, text.length)
    }
    this.options.onChange?.(text)
  }

  get selectedText() {
    if (this.editor) return this.editor.selectedText
    return this.box ? this.box.value.slice(this.box.selectionStart, this.box.selectionEnd) : ''
  }

  markedLines() {
    return this.editor ? this.editor.markedLines() : []
  }

  /**
   * Bring CodeMirror in (once; later calls get the same promise). Until it
   * is in, the text box stands in. Resolves to the editor, or null when it
   * could not load and the box carries on.
   */
  load() {
    if (this.editor) return Promise.resolve(this.editor)
    if (this._loading) return this._loading
    this._showBox()
    this._loading = import('./python-editor.js')
      // No module: the part was gone after a deploy and the page is reloading
      // onto the new build (src/ui/new-build.js), the box's text saved.
      .then((m) => (m ? this._swap(m.PythonEditor) : null))
      .catch((err) => {
        console.warn('The Python editor did not load; a plain text box stands in.', err)
        return null
      })
      .then((editor) => {
        if (!editor) this._loading = null // a later switch to Python tries again
        return editor
      })
    return this._loading
  }

  /** The plain text box that holds the program until CodeMirror is in. */
  _showBox() {
    if (this.box) return
    const box = document.createElement('textarea')
    box.className = 'python-editor-box'
    box.value = this._text
    box.setAttribute('aria-label', this.options.label)
    if (this.options.describedBy) box.setAttribute('aria-describedby', this.options.describedBy)
    for (const [k, v] of Object.entries({ autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', wrap: 'off' })) box.setAttribute(k, v)
    box.addEventListener('input', () => {
      this._text = box.value
      this.options.onChange?.(box.value)
    })
    box.addEventListener('keydown', (e) => {
      // Tab indents, as in the editor; Escape first lets Tab leave (the help text says so).
      if (e.key === 'Escape') box.dataset.tabLeaves = '1'
      else if (e.key === 'Tab' && !e.shiftKey && !box.dataset.tabLeaves && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        box.setRangeText('    ', box.selectionStart, box.selectionEnd, 'end')
        box.dispatchEvent(new Event('input'))
      } else if (e.key !== 'Shift') delete box.dataset.tabLeaves
    })
    // An input method's composition under way: the swap waits for it to end.
    this._composingNow = false
    box.addEventListener('compositionstart', () => { this._composingNow = true })
    box.addEventListener('compositionend', () => { this._composingNow = false })
    // Gone elsewhere (the terminal, a file's name): the editor does not take the focus back.
    box.addEventListener('blur', () => { this._wantsFocus = false })
    this.parent.append(box)
    // The cursor at the end, as the editor puts it.
    box.setSelectionRange(box.value.length, box.value.length)
    this.box = box
  }

  /**
   * Put CodeMirror in the box's place, with what the box holds. Never while
   * the student is mid-way through composing a character (an input method's
   * composition), which the swap would cut short: then once it ends.
   */
  async _swap(PythonEditor) {
    const box = this.box
    if (this._composingNow) await new Promise((resolve) => box.addEventListener('compositionend', () => setTimeout(resolve), { once: true }))
    const text = box.value
    const { selectionStart: from, selectionEnd: to } = box
    const focused = document.activeElement === box
    const editor = new PythonEditor(this.parent, this.options)
    // Its first value is the box's, without telling the app: the app has it already.
    const onChange = editor.onChange
    editor.onChange = null
    editor.value = text
    editor.onChange = onChange
    editor.view.dispatch({ selection: { anchor: Math.min(from, text.length), head: Math.min(to, text.length) } })
    box.remove()
    this.box = null
    this.editor = editor
    if (this._line) editor.showLine(this._line)
    this._line = null
    // The focus only if the box had it, or it was asked for and nothing else has it since.
    const free = !document.activeElement || document.activeElement === document.body
    if (focused || (this._wantsFocus && free)) editor.focus()
    this._wantsFocus = false
    return editor
  }

  focus() {
    if (this.editor) return this.editor.focus()
    this._wantsFocus = true
    this.box?.focus()
  }

  showLine(line) {
    if (this.editor) return this.editor.showLine(line)
    this._line = line || null
    if (this.box && line) {
      const lines = this.box.value.split('\n')
      if (line <= lines.length) {
        const from = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0)
        this.box.setSelectionRange(from, from + lines[line - 1].length)
      }
    }
  }

  // Snippets: before the editor is in, one clicked or dropped on the box
  // goes into the box at once, so the program always holds it.

  previewDrop(snippet, x, y, bottom) {
    this.editor?.previewDrop(snippet, x, y, bottom)
  }

  clearPreview() {
    this.editor?.clearPreview()
  }

  drop(snippet, x, y, bottom) {
    if (this.editor) return this.editor.drop(snippet, x, y, bottom)
    const r = this.box?.getBoundingClientRect()
    if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return false
    this.insert(snippet)
    return true
  }

  insert(snippet) {
    if (this.editor) return this.editor.insert(snippet)
    this.load() // shows the box, if it is not there yet
    const box = this.box
    const { lines, line, col } = snippetInLines(box.value, box.selectionStart, box.selectionEnd, snippet)
    box.value = lines.join('\n')
    const at = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + col
    box.setSelectionRange(at, at)
    box.dispatchEvent(new Event('input'))
    box.focus()
  }
}

const indentOf = (l) => l.length - l.trimStart().length
const blank = (l) => !l.trim()
// A line that opens a block: ends in a colon, a comment after it aside.
const opensBlock = (l) => /:$/.test(l.replace(/\s#[^'"]*$/, '').trimEnd())

/**
 * The program's lines with a snippet put in, as the editor puts it
 * (snippet-drop.js insertSnippet, in plain text): a value replaces the
 * selection; a line goes on the cursor's line when it is blank, else on a
 * new line after it, as deep as the code around allows (into the body when
 * the line before opens a block); what it needs at the top goes after the
 * imports, radio's first of all. Returns the lines and where the cursor
 * goes, after the snippet.
 */
export function snippetInLines(text, from, to, snippet) {
  let lines
  let line
  let col
  if (!snippet.line) {
    const out = text.slice(0, from) + snippet.code + text.slice(to)
    const upTo = text.slice(0, from) + snippet.code
    lines = out.split('\n')
    line = upTo.split('\n').length - 1
    col = upTo.length - upTo.lastIndexOf('\n') - 1
  } else {
    lines = text.split('\n')
    const n = text.slice(0, from).split('\n').length - 1
    const fill = blank(lines[n])
    const at = fill ? n : n + 1
    let prev = -1
    for (let i = at - 1; i >= 0; i--) if (!blank(lines[i])) { prev = i; break }
    let next = -1
    for (let i = fill ? at + 1 : at; i < lines.length; i++) if (!blank(lines[i])) { next = i; break }
    let indent = 0
    if (prev >= 0 && opensBlock(lines[prev])) indent = indentOf(lines[prev]) + 4
    else if (prev >= 0) {
      const max = indentOf(lines[prev])
      const min = next < 0 ? 0 : Math.min(indentOf(lines[next]), max)
      indent = Math.min(max, Math.max(min, indentOf(lines[n])))
    }
    const code = snippet.code.split('\n').map((l) => (l ? ' '.repeat(indent) + l : l))
    lines.splice(at, fill ? 1 : 0, ...code)
    line = at + code.length - 1
    col = code[code.length - 1].length
  }
  // What it needs at the top.
  const has = new Set(lines.map((l) => l.trim()))
  const needs = [...(snippet.imports || []), ...(snippet.setup || [])].filter((l) => !has.has(l))
  const put = (i, add) => {
    lines.splice(i, 0, ...add)
    if (i <= line) line += add.length
  }
  const firstImport = lines.findIndex((l) => /^(import|from)\s/.test(l))
  const radio = needs.filter((l) => l === 'import radio')
  if (radio.length) put(firstImport >= 0 ? firstImport : topOfCode(lines), radio)
  const rest = needs.filter((l) => l !== 'import radio')
  if (rest.length) {
    let last = -1
    lines.forEach((l, i) => { if (/^(import|from)\s/.test(l)) last = i })
    put(last >= 0 ? last + 1 : topOfCode(lines), rest)
  }
  return { lines, line, col }
}

/** The first line of code, after any opening comments and blank lines. */
function topOfCode(lines) {
  let i = 0
  while (i < lines.length && (blank(lines[i]) || lines[i].startsWith('#'))) i++
  return i
}
