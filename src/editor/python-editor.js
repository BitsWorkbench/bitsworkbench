/**
 * The Python editor for typed programs: CodeMirror 6 with Python's grammar,
 * in the app's colours. The app talks to it through this small surface
 * (value, change, focus, the paused line, snippets) and never touches
 * CodeMirror itself.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, Decoration, gutter, GutterMarker } from '@codemirror/view'
import { EditorState, StateEffect, StateField, RangeSet } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, temporarilySetTabFocusMode } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, indentOnInput, indentUnit, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { python } from '@codemirror/lang-python'
import { tags } from '@lezer/highlight'
import { t } from '../i18n/index.js'
import { snippetDrop, previewSnippet, dropSnippet, insertSnippet } from './snippet-drop.js'

// The same colours as the Python palette's snippets (app.css .python-editor .k and on).
const colours = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword, tags.bool, tags.null, tags.self], class: 'k' },
  { tag: [tags.string, tags.special(tags.string)], class: 's' },
  { tag: tags.comment, class: 'c' },
  { tag: tags.number, class: 'n' },
])

/** CodeMirror's own words (the find panel, folding), in the app's language. */
const phrases = () =>
  EditorState.phrases.of({
    Find: t('editor.find'),
    Replace: t('editor.replace'),
    next: t('editor.next'),
    previous: t('editor.previous'),
    all: t('editor.all'),
    'match case': t('editor.matchCase'),
    regexp: t('editor.regexp'),
    'by word': t('editor.byWord'),
    replace: t('editor.replaceOne'),
    'replace all': t('editor.replaceAll'),
    close: t('editor.close'),
    'current match': t('editor.currentMatch'),
    'on line': t('editor.onLine'),
    'replaced match on line $': t('editor.replacedOne'),
    'replaced $ matches': t('editor.replacedMany'),
    'Go to line': t('editor.goToLine'),
    go: t('editor.go'),
    'Folded lines': t('editor.foldedLines'),
    'Unfolded lines': t('editor.unfoldedLines'),
    'Fold line': t('editor.foldLine'),
    'Unfold line': t('editor.unfoldLine'),
    'folded code': t('editor.foldedCode'),
    unfold: t('editor.unfold'),
    to: t('editor.to'),
    'Selection deleted': t('editor.selectionDeleted'),
    'Control character': t('editor.controlCharacter'),
  })

/** The line a paused program is at: set with an effect, cleared by any edit. */
const setRunLine = StateEffect.define()
const runLineMark = Decoration.line({ class: 'cm-run-line' })
const runLine = StateField.define({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const e of tr.effects) {
      if (e.is(setRunLine)) {
        if (!e.value) return Decoration.none
        return Decoration.set([runLineMark.range(tr.state.doc.line(e.value).from)])
      }
    }
    return tr.docChanged ? Decoration.none : marks
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * Lines with no block of their own (they become grey Python blocks): a quiet
 * grey mark in a narrow gutter, with a tooltip. Set with an effect; an edit
 * moves the marks with their lines until they are worked out again.
 */
const setNoBlock = StateEffect.define()
class NoBlockMark extends GutterMarker {
  toDOM() {
    const mark = document.createElement('span')
    mark.className = 'cm-no-block-mark'
    mark.title = t('editor.noBlock')
    return mark
  }
}
const noBlockMark = new NoBlockMark()
const noBlock = StateField.define({
  create: () => RangeSet.empty,
  update(marks, tr) {
    marks = marks.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setNoBlock)) continue
      const doc = tr.state.doc
      marks = RangeSet.of(e.value.filter((l) => l >= 1 && l <= doc.lines).map((l) => noBlockMark.range(doc.line(l).from)))
    }
    return marks
  },
})
const noBlockGutter = gutter({ class: 'cm-no-block-gutter', markers: (view) => view.state.field(noBlock) })

/** How long typing pauses before the marks are worked out again (ms). */
const NO_BLOCK_PAUSE = 400

export class PythonEditor {
  /**
   * @param {HTMLElement} parent where the editor goes
   * @param {{label: string, describedBy?: string, onChange?: (text: string) => void,
   *   noBlockLines?: (text: string) => number[]}} options noBlockLines gives the lines
   *   of a program with no block of their own, to mark
   */
  constructor(parent, { label, describedBy, onChange, noBlockLines }) {
    this.onChange = onChange
    this.noBlockLines = noBlockLines
    this.extensions = [
      noBlockGutter,
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      history(),
      drawSelection(),
      dropCursor(),
      indentUnit.of('    '),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      // At the top: the blocks/Python button sits at the bottom left.
      search({ top: true }),
      syntaxHighlighting(colours),
      python(),
      runLine,
      noBlock,
      snippetDrop,
      phrases(),
      keymap.of([
        // Escape, then Tab, leaves the editor (the help text says so).
        { key: 'Escape', run: temporarilySetTabFocusMode },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.contentAttributes.of({
        'aria-label': label,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        autocapitalize: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && onChange) onChange(this.value)
        if (u.docChanged) this._markLater()
      }),
    ]
    this.view = new EditorView({ parent, state: EditorState.create({ extensions: this.extensions }) })
  }

  get value() {
    return this.view.state.doc.toString()
  }

  /**
   * Replace the whole program (a new project, or switching to text mode).
   * A fresh state, so undo history starts here: Ctrl+Z cannot undo the
   * program away to nothing. The cursor starts at the end, where a new line
   * of program usually goes.
   */
  set value(text) {
    if (text === this.value) return
    this.view.setState(EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: this.extensions }))
    this.onChange?.(text)
    this._markLater()
  }

  /** Work out the lines with no block once typing pauses. */
  _markLater() {
    if (!this.noBlockLines) return
    clearTimeout(this._markTimer)
    this._markTimer = setTimeout(() => {
      const text = this.value
      let lines = []
      try {
        lines = this.noBlockLines(text) || []
      } catch {
        lines = []
      }
      // Typing went on meanwhile: the next pause marks it.
      if (text === this.value) this.view.dispatch({ effects: setNoBlock.of(lines) })
    }, NO_BLOCK_PAUSE)
  }

  /** The lines marked as having no block, for tests. */
  markedLines() {
    const lines = []
    const doc = this.view.state.doc
    this.view.state.field(noBlock).between(0, doc.length, (from) => {
      lines.push(doc.lineAt(from).number)
    })
    return lines
  }

  /** The selected text (empty when nothing is selected). */
  get selectedText() {
    const { from, to } = this.view.state.selection.main
    return this.view.state.sliceDoc(from, to)
  }

  focus() {
    this.view.focus()
  }

  /**
   * Show where a dragged snippet would land: (x, y) is its card's left edge
   * at its first line; `bottom`, the card's bottom edge, says which code its
   * shape covers (a loop or an if takes that code into its body).
   */
  previewDrop(snippet, x, y, bottom) {
    previewSnippet(this.view, snippet, x, y, bottom)
  }

  /** Clear the drop preview (the drag left the editor, or was cancelled). */
  clearPreview() {
    previewSnippet(this.view, null)
  }

  /** Drop a snippet there (as previewDrop); false if the point is not in the editor. */
  drop(snippet, x, y, bottom) {
    return dropSnippet(this.view, snippet, x, y, bottom)
  }

  /** Put a snippet in at the cursor (a click, or Enter on the palette). */
  insert(snippet) {
    insertSnippet(this.view, snippet)
  }

  /** Mark and select the line a paused program is at; null clears it. */
  showLine(line) {
    const doc = this.view.state.doc
    if (!line || line > doc.lines) {
      this.view.dispatch({ effects: setRunLine.of(null) })
      return
    }
    const { from, to } = doc.line(line)
    this.view.dispatch({
      effects: [setRunLine.of(line), EditorView.scrollIntoView(from, { y: 'center' })],
      selection: { anchor: from, head: to },
    })
  }
}
