/**
 * The Python editor for typed programs: CodeMirror 6 with Python's grammar,
 * in the app's colours. The app talks to it through this small surface
 * (value, change, focus, the paused line) and never touches CodeMirror itself.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, Decoration } from '@codemirror/view'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab, temporarilySetTabFocusMode } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, indentOnInput, indentUnit, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { python } from '@codemirror/lang-python'
import { tags } from '@lezer/highlight'
import { t } from '../i18n/index.js'

// The same colours as the blocks' read-only Python view (app.css .python-view).
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

export class PythonEditor {
  /**
   * @param {HTMLElement} parent where the editor goes
   * @param {{label: string, describedBy?: string, onChange?: (text: string) => void}} options
   */
  constructor(parent, { label, describedBy, onChange }) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        extensions: [
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
          }),
        ],
      }),
    })
  }

  get value() {
    return this.view.state.doc.toString()
  }

  /** Replace the whole program (a new project, or switching to text mode). */
  set value(text) {
    if (text === this.value) return
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } })
  }

  /** The selected text (empty when nothing is selected). */
  get selectedText() {
    const { from, to } = this.view.state.selection.main
    return this.view.state.sliceDoc(from, to)
  }

  focus() {
    this.view.focus()
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
