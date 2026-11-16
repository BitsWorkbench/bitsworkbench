/**
 * The file browser beside the program: a folder on the computer (where the
 * browser can open one) and this browser's own files, each a tree. Open a
 * file to work on it; make files and folders; rename and delete them.
 *
 * It shows and asks; the app opens, makes, renames and removes (through the
 * FileStores), so what the open file is, and what saving means, stay in one
 * place. Each action the app takes answers null, or the words of what went
 * wrong, shown under the name being typed.
 */
import { t, tHtml } from '../i18n/index.js'

// Letters of any language (música.py), digits, _ - and spaces; one ending.
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_\- ]*(\.[\p{L}\p{N}_]+)?$/u
const DIR_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_\- ]*$/u

export class FilesPanel {
  /**
   * @param {HTMLElement} host
   * @param {{ stores: { browser: object, folder: object | null },
   *           open: (ref) => Promise<void>,
   *           create: (store: string, path: string, kind: 'file' | 'dir') => Promise<string | null>,
   *           rename: (store: string, from: string, to: string) => Promise<string | null>,
   *           remove: (store: string, path: string, kind: 'file' | 'dir') => Promise<void>,
   *           attach: () => Promise<void>, reopen: () => Promise<void> }} actions
   */
  constructor(host, actions) {
    Object.assign(this, actions)
    this.host = host
    this.current = null // { store, path }
    this.expanded = new Set() // `${store}:${path}`
    this.form = null // { act, store, dir, path }
    host.setAttribute('aria-label', t('files.label'))
    host.addEventListener('click', (e) => this._click(e))
    host.addEventListener('submit', (e) => {
      e.preventDefault()
      this._submit()
    })
    host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.form) {
        e.stopPropagation()
        this._closeForm()
      }
    })
  }

  /** Draw the panel: the folder (or the offer of one), then this browser's files. */
  async render() {
    const folder = this.stores.folder
    let top = ''
    if (folder?.name) {
      top = this._section('folder', `📁 ${esc(folder.name)}`, t('files.folderLabel', { name: folder.name }), true)
    } else if (folder) {
      const again = await folder.remembered()
      top = `<div class="files-attach">
        <p class="files-note">${tHtml('files.intro')}</p>
        ${again ? `<button type="button" class="btn btn-small" data-act="reopen">${tHtml('files.reopen', { name: again })}</button>` : ''}
        <button type="button" class="btn btn-small${again ? ' btn-ghost' : ''}" data-act="attach">${tHtml('files.openFolder')}</button>
      </div>`
    }
    this.host.innerHTML = top + this._section('browser', `💻 ${tHtml('files.thisBrowser')}`, t('files.browserLabel'), false)
    for (const list of this.host.querySelectorAll('.files-tree')) await this._fill(list, list.dataset.store, '')
    if (this.form) this._placeForm()
  }

  _section(store, title, label, other) {
    return `<section class="files-section" data-store="${store}">
      <div class="files-head">
        <span class="files-folder">${title}</span>
        <button type="button" class="btn-icon" data-act="new-file" title="${attr(t('files.newFile'))}" aria-label="${attr(t('files.newFileIn', { place: label }))}">📄<span aria-hidden="true">+</span></button>
        <button type="button" class="btn-icon" data-act="new-dir" title="${attr(t('files.newFolder'))}" aria-label="${attr(t('files.newFolderIn', { place: label }))}">📁<span aria-hidden="true">+</span></button>
        ${other ? `<button type="button" class="btn-icon" data-act="attach" title="${attr(t('files.openOther'))}" aria-label="${attr(t('files.openOther'))}">⋯</button>` : ''}
      </div>
      <ul class="files-tree" data-store="${store}" aria-label="${attr(label)}"></ul>
    </section>`
  }

  /** Mark the open file, { store, path } (null: none). */
  setCurrent(ref) {
    this.current = ref
    for (const b of this.host.querySelectorAll('.files-item[data-kind="file"]')) {
      const on = this._isCurrent(b.dataset.store, b.dataset.path)
      b.classList.toggle('is-current', on)
      if (on) b.setAttribute('aria-current', 'true')
      else b.removeAttribute('aria-current')
    }
  }

  _isCurrent(store, path) {
    return this.current?.store === store && this.current.path === path
  }

  async _fill(list, store, dir) {
    let entries
    try {
      entries = await this.stores[store].list(dir)
    } catch {
      entries = []
    }
    if (!entries.length) {
      list.innerHTML = dir ? '' : `<li class="files-empty">${tHtml('files.empty')}</li>`
      return
    }
    list.innerHTML = entries
      .map((e) => {
        const py = e.kind === 'file' && /\.py$/i.test(e.name)
        const open = e.kind === 'dir' && this.expanded.has(`${store}:${e.path}`)
        const icon = e.kind === 'dir' ? (open ? '📂' : '📁') : py ? '🐍' : '📄'
        const current = e.kind === 'file' && this._isCurrent(store, e.path)
        const a = (act, emoji, key) =>
          `<button type="button" class="btn-icon" data-act="${act}" title="${attr(t(key))}" aria-label="${attr(t(key + 'Named', { name: e.name }))}">${emoji}</button>`
        return `<li>
          <div class="files-row">
            <button type="button" class="files-item${py || e.kind === 'dir' ? '' : ' is-other'}${current ? ' is-current' : ''}"
              data-store="${store}" data-path="${attr(e.path)}" data-kind="${e.kind}"
              ${e.kind === 'dir' ? `aria-expanded="${open}"` : ''}${py || e.kind === 'dir' ? '' : ' aria-disabled="true"'}
              ${current ? 'aria-current="true"' : ''}><span aria-hidden="true">${icon}</span> ${esc(e.name)}</button>
            <span class="files-actions">
              ${e.kind === 'dir' ? a('new-file', '📄', 'files.newFileHere') : ''}
              ${a('rename', '✏️', 'files.rename')}${a('delete', '🗑️', 'files.delete')}
            </span>
          </div>
          ${e.kind === 'dir' ? `<ul class="files-sub"${open ? '' : ' hidden'}></ul>` : ''}
        </li>`
      })
      .join('')
    for (const sub of list.querySelectorAll(':scope > li > .files-sub:not([hidden])')) {
      await this._fill(sub, store, sub.parentElement.querySelector('.files-item').dataset.path)
    }
  }

  async _click(e) {
    const actEl = e.target.closest('[data-act]')
    const act = actEl?.dataset.act
    const row = e.target.closest('li')?.querySelector(':scope > .files-row > .files-item')
    const store = e.target.closest('[data-store]')?.dataset.store
    if (act === 'attach') return this.attach()
    if (act === 'reopen') return this.reopen()
    if (act === 'cancel') return this._closeForm()
    if (act === 'new-file' || act === 'new-dir') {
      // In the folder whose row it is on, or at the section's top.
      const dir = row && actEl.closest('.files-actions') ? row.dataset.path : ''
      if (dir) await this._expand(row, true)
      return this._openForm({ act, store, dir })
    }
    if (act === 'rename') return this._openForm({ act, store: row.dataset.store, path: row.dataset.path, kind: row.dataset.kind })
    if (act === 'delete') return this.remove(row.dataset.store, row.dataset.path, row.dataset.kind)

    const item = e.target.closest('.files-item')
    if (!item || item.getAttribute('aria-disabled') === 'true') return
    if (item.dataset.kind === 'dir') await this._expand(item, !this.expanded.has(`${item.dataset.store}:${item.dataset.path}`))
    else await this.open({ store: item.dataset.store, path: item.dataset.path })
  }

  async _expand(item, open) {
    const key = `${item.dataset.store}:${item.dataset.path}`
    if (open) this.expanded.add(key)
    else this.expanded.delete(key)
    item.setAttribute('aria-expanded', String(open))
    item.firstElementChild.textContent = open ? '📂' : '📁'
    const sub = item.closest('li').querySelector(':scope > .files-sub')
    sub.hidden = !open
    if (open) await this._fill(sub, item.dataset.store, item.dataset.path)
  }

  _openForm(form) {
    this.form = form
    this._placeForm()
  }

  /** The one name form, under the row it is about, or at the top of its section. */
  _placeForm() {
    const f = this.form
    this.host.querySelector('.files-form')?.remove()
    const label =
      f.act === 'rename'
        ? t('files.renameLabel', { name: baseName(f.path) })
        : t(f.act === 'new-dir' ? 'files.newFolderName' : 'files.newName')
    const el = document.createElement('form')
    el.className = 'files-form'
    el.innerHTML = `
      <label class="files-form-label" for="files-name">${esc(label)}</label>
      <input id="files-name" class="files-name" autocomplete="off" spellcheck="false" />
      <p class="files-error" role="alert"></p>
      <div class="files-form-actions">
        <button type="button" class="btn btn-small btn-ghost" data-act="cancel">${tHtml('files.cancel')}</button>
        <button type="submit" class="btn btn-small">${tHtml(f.act === 'rename' ? 'files.renameDo' : 'files.create')}</button>
      </div>`
    const at = f.act === 'rename' ? f.path : f.dir
    const row = at && [...this.host.querySelectorAll(`.files-item[data-store="${f.store}"]`)].find((b) => b.dataset.path === at)
    if (row) row.closest('.files-row').after(el)
    else this.host.querySelector(`.files-section[data-store="${f.store}"] .files-head`)?.after(el)
    const input = el.querySelector('.files-name')
    input.value = f.act === 'rename' ? baseName(f.path) : ''
    input.focus()
    if (f.act === 'rename') input.setSelectionRange(0, input.value.replace(/\.py$/i, '').length)
  }

  _closeForm() {
    const f = this.form
    this.form = null
    this.host.querySelector('.files-form')?.remove()
    this.host.querySelector(`.files-section[data-store="${f?.store}"] [data-act="new-file"]`)?.focus()
  }

  async _submit() {
    const f = this.form
    const el = this.host.querySelector('.files-form')
    const error = el.querySelector('.files-error')
    let name = el.querySelector('.files-name').value.trim()
    const dirLike = f.act === 'new-dir' || (f.act === 'rename' && f.kind === 'dir')
    // A program's name needs no ending: it is a Python file.
    if (!dirLike && name && !name.includes('.')) name += '.py'
    if (!(dirLike ? DIR_NAME : NAME).test(name)) {
      error.textContent = t('files.badName')
      return
    }
    const parent = f.act === 'rename' ? f.path.split('/').slice(0, -1).join('/') : f.dir
    const path = parent ? `${parent}/${name}` : name
    if (f.act === 'rename' && path === f.path) return this._closeForm()
    const problem =
      f.act === 'rename'
        ? await this.rename(f.store, f.path, path)
        : await this.create(f.store, path, f.act === 'new-dir' ? 'dir' : 'file')
    if (problem) {
      error.textContent = problem
      return
    }
    this.form = null
    await this.render()
  }
}

const baseName = (path) => path.split('/').pop()

function esc(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

function attr(text) {
  return esc(text).replace(/"/g, '&quot;')
}
