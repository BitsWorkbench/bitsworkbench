/**
 * The palette beside the Python: the blocks' categories, and in each the
 * Python its blocks make, on a card in the category's colour. A card can be
 * dragged into the editor (mouse, pen or touch: one pointer path for all),
 * or clicked, or chosen with Enter, which puts it in at the cursor.
 *
 * The palette owns no editing: it asks the editor to preview, drop and
 * insert. `beforeUse` runs first, so the app can make the Python editable.
 */
import { snippetsFor } from './snippets.js'
import { highlightPython } from '../blocks/index.js'
import { t } from '../i18n/index.js'

const DRAG_START_PX = 6

export class SnippetPalette {
  /**
   * @param {HTMLElement} host the palette's element
   * @param {{ editor: () => import('./python-editor.js').PythonEditor, beforeUse: () => void }} options
   */
  constructor(host, { editor, beforeUse }) {
    this.host = host
    this.editor = editor
    this.beforeUse = beforeUse
    this.targetId = undefined
    this.categories = []
    this.open = -1

    host.innerHTML = `
      <div class="py-cats" role="group"></div>
      <div class="py-flyout" id="py-flyout" role="region" hidden>
        <p class="sr-only" id="py-flyout-hint">${t('palette.hint')}</p>
        <ul class="py-snippets"></ul>
      </div>`
    host.setAttribute('aria-label', t('palette.label'))
    this.cats = host.querySelector('.py-cats')
    this.flyout = host.querySelector('.py-flyout')
    this.list = host.querySelector('.py-snippets')

    this.cats.addEventListener('click', (e) => {
      const button = e.target.closest('.py-cat')
      if (!button) return
      const i = Number(button.dataset.i)
      // From the keyboard, go straight to the first snippet, as Blockly does.
      this.show(this.open === i ? -1 : i, { focus: e.detail === 0 })
    })
    this.list.addEventListener('click', (e) => {
      const card = e.target.closest('.snippet')
      if (!card || this.justDragged) return
      this.use(this.snippetOf(card))
    })
    this.list.addEventListener('keydown', (e) => this.listKeys(e))
    this.flyout.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      const button = this.cats.querySelector(`.py-cat[data-i="${this.open}"]`)
      this.show(-1)
      button?.focus()
    })
    // A press anywhere else closes the flyout, as Blockly's does.
    document.addEventListener('pointerdown', (e) => {
      if (this.open >= 0 && !host.contains(e.target)) this.show(-1)
    })
    this.list.addEventListener('pointerdown', (e) => this.pointerDown(e))
  }

  /** Build the palette for a board (again only when the board changed). */
  render(targetId) {
    if (targetId === this.targetId) return
    this.targetId = targetId
    this.categories = snippetsFor(targetId)
    this.cats.innerHTML = this.categories
      .map((c, i) =>
        c.kind === 'sep'
          ? '<div class="py-sep" role="separator"></div>'
          : `<button type="button" class="py-cat" data-i="${i}" style="--c: ${c.colour}" aria-expanded="false" aria-controls="py-flyout">${esc(c.name)}</button>`,
      )
      .join('')
    this.show(-1)
  }

  /** Open category i's flyout (-1 closes it). */
  show(i, { focus = false } = {}) {
    this.open = i
    for (const b of this.cats.querySelectorAll('.py-cat')) {
      const on = Number(b.dataset.i) === i
      b.classList.toggle('is-open', on)
      b.setAttribute('aria-expanded', String(on))
    }
    const cat = this.categories[i]
    this.flyout.hidden = !cat
    if (!cat) return
    this.flyout.setAttribute('aria-label', cat.name)
    this.list.innerHTML = cat.snippets
      .map(
        (s, j) =>
          `<li><button type="button" class="snippet${s.line ? '' : ' is-value'}" data-j="${j}" style="--c: ${cat.colour}" aria-describedby="py-flyout-hint"><code>${highlightPython(s.code)}</code></button></li>`,
      )
      .join('')
    this.list.scrollTop = 0
    if (focus) this.list.querySelector('.snippet')?.focus()
  }

  snippetOf(card) {
    return this.categories[this.open].snippets[Number(card.dataset.j)]
  }

  /** Put a snippet in at the cursor. */
  use(snippet) {
    this.beforeUse()
    this.show(-1)
    this.editor().insert(snippet)
  }

  /** Up and down move between the cards. */
  listKeys(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const cards = [...this.list.querySelectorAll('.snippet')]
    const at = cards.indexOf(document.activeElement)
    const next = cards[Math.max(0, Math.min(cards.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  // ---------------------------------------------------------------- drag

  pointerDown(e) {
    const card = e.target.closest('.snippet')
    if (!card || e.button !== 0) return
    const snippet = this.snippetOf(card)
    const rect = card.getBoundingClientRect()
    const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    const start = { x: e.clientX, y: e.clientY }
    let ghost = null

    // Where the card's first line would sit, and its bottom edge (how far
    // its shape reaches down over the code): what the editor places by.
    const at = (ev) => ({ x: ev.clientX - grab.x, y: ev.clientY - grab.y + 14, bottom: ev.clientY - grab.y + rect.height })

    const move = (ev) => {
      if (!ghost) {
        const dx = ev.clientX - start.x
        const dy = ev.clientY - start.y
        if (Math.hypot(dx, dy) < DRAG_START_PX) return
        // On touch, an upward or downward swipe scrolls the list instead.
        if (ev.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) return end()
        this.beforeUse()
        ghost = card.cloneNode(true)
        ghost.classList.add('snippet-dragging')
        ghost.removeAttribute('aria-describedby')
        ghost.style.width = `${rect.width}px`
        document.body.append(ghost)
        this.show(-1)
      }
      ev.preventDefault()
      ghost.style.transform = `translate(${ev.clientX - grab.x}px, ${ev.clientY - grab.y}px)`
      const p = at(ev)
      this.editor().previewDrop(snippet, p.x, p.y, p.bottom)
    }
    const up = (ev) => {
      if (ghost) {
        const p = at(ev)
        this.editor().drop(snippet, p.x, p.y, p.bottom)
        // The click that follows a drag is not a click on the card.
        this.justDragged = true
        setTimeout(() => (this.justDragged = false), 0)
      }
      end()
    }
    const cancel = () => {
      if (ghost) this.editor().clearPreview()
      end()
    }
    const end = () => {
      ghost?.remove()
      ghost = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }
}

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}
