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
    this._snippets = [] // snippets put in before it loaded, in order
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
    if (this._composing(box)) await new Promise((resolve) => box.addEventListener('compositionend', () => setTimeout(resolve), { once: true }))
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
    for (const snippet of this._snippets.splice(0)) editor.insert(snippet)
    if (this._line) editor.showLine(this._line)
    this._line = null
    if (focused || this._wantsFocus) editor.focus()
    this._wantsFocus = false
    return editor
  }

  _composing(box) {
    if (this._composingNow === undefined) {
      this._composingNow = false
      box.addEventListener('compositionstart', () => { this._composingNow = true })
      box.addEventListener('compositionend', () => { this._composingNow = false })
    }
    return this._composingNow
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

  // Snippets: the palette is shown only in Python, which loads the editor;
  // one used before it is in goes in once it is.

  previewDrop(snippet, x, y, bottom) {
    this.editor?.previewDrop(snippet, x, y, bottom)
  }

  clearPreview() {
    this.editor?.clearPreview()
  }

  drop(snippet, x, y, bottom) {
    return this.editor ? this.editor.drop(snippet, x, y, bottom) : false
  }

  insert(snippet) {
    if (this.editor) return this.editor.insert(snippet)
    this._snippets.push(snippet)
    this.load().then((editor) => {
      // It could not load: the box takes the snippets' code as it is.
      if (editor || !this.box) return
      for (const s of this._snippets.splice(0)) {
        const box = this.box
        box.setRangeText(s.line ? `\n${s.code}\n` : s.code, box.selectionStart, box.selectionEnd, 'end')
        box.dispatchEvent(new Event('input'))
      }
    })
  }
}
