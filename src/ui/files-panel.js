/**
 * The Files panel beside the Python: pick a folder on the computer, see its
 * files, open a Python file, make a new one. It shows and asks; the app
 * opens, saves and makes the files (through the FileStore), so what a file
 * holds and what Save means stay in one place.
 *
 * Where no folder can be opened (no FileStore), it says so and offers to
 * open a single Python file instead.
 */
import { t, tHtml } from '../i18n/index.js'

export class FilesPanel {
  /**
   * @param {HTMLElement} host
   * @param {{ store: object | null, open: (path: string) => Promise<void>,
   *           create: (path: string) => Promise<void>, openSingle: (file: File) => Promise<void> }} actions
   */
  constructor(host, { store, open, create, openSingle }) {
    Object.assign(this, { host, store, open, create, openSingle })
    this.current = null
    this.expanded = new Set()
    host.setAttribute('aria-label', t('files.label'))
    host.addEventListener('click', (e) => this._click(e))
    host.addEventListener('submit', (e) => {
      e.preventDefault()
      this._createFromForm()
    })
    host.addEventListener('change', (e) => {
      if (e.target.matches('.files-single')) this.openSingle(e.target.files?.[0]).finally(() => (e.target.value = ''))
    })
  }

  /** Draw the panel for where things stand: no folder yet, or a folder's files. */
  async render() {
    if (!this.store) {
      this.host.innerHTML = `
        <p class="files-note">${tHtml('files.unsupported')}</p>
        <label class="btn btn-small files-pick">${tHtml('files.openSingle')}
          <input type="file" class="files-single sr-only" accept=".py,text/x-python" /></label>`
      return
    }
    if (!this.store.name) {
      const again = await this.store.remembered()
      this.host.innerHTML = `
        <p class="files-note">${tHtml('files.intro')}</p>
        ${again ? `<button type="button" class="btn btn-small" data-act="reopen">${tHtml('files.reopen', { name: again })}</button>` : ''}
        <button type="button" class="btn btn-small${again ? ' btn-ghost' : ''}" data-act="pick">${tHtml('files.openFolder')}</button>`
      return
    }
    this.host.innerHTML = `
      <div class="files-head">
        <span class="files-folder" title="${attr(this.store.name)}">📁 ${esc(this.store.name)}</span>
        <button type="button" class="btn-icon" data-act="pick" title="${attr(t('files.openOther'))}" aria-label="${attr(t('files.openOther'))}">⋯</button>
      </div>
      <ul class="files-tree" aria-label="${attr(t('files.folderLabel', { name: this.store.name }))}"></ul>
      <button type="button" class="btn btn-small files-new" data-act="new">${tHtml('files.newFile')}</button>
      <form class="files-form" hidden>
        <label class="files-form-label" for="files-name">${tHtml('files.newName')}</label>
        <input id="files-name" class="files-name" autocomplete="off" spellcheck="false" />
        <p class="files-error" role="alert"></p>
        <div class="files-form-actions">
          <button type="button" class="btn btn-small btn-ghost" data-act="cancel">${tHtml('files.cancel')}</button>
          <button type="submit" class="btn btn-small">${tHtml('files.create')}</button>
        </div>
      </form>`
    await this._fill(this.host.querySelector('.files-tree'), '')
  }

  /** Mark the open file, { path, folder } (null: none); it shows while its folder is the open one. */
  setCurrent(file) {
    this.currentFile = file
    this.current = this._currentPath()
    const path = this.current
    for (const b of this.host.querySelectorAll('.files-item[data-kind="file"]')) {
      const on = b.dataset.path === path
      b.classList.toggle('is-current', on)
      if (on) b.setAttribute('aria-current', 'true')
      else b.removeAttribute('aria-current')
    }
  }

  _currentPath() {
    const f = this.currentFile
    return f && this.store?.name === f.folder ? f.path : null
  }

  async _fill(list, dir) {
    this.current = this._currentPath()
    let entries
    try {
      entries = await this.store.list(dir)
    } catch {
      entries = []
    }
    if (!entries.length) {
      list.innerHTML = `<li class="files-empty">${tHtml('files.empty')}</li>`
      return
    }
    list.innerHTML = entries
      .map((e) => {
        const py = e.kind === 'file' && /\.py$/i.test(e.name)
        const open = e.kind === 'dir' && this.expanded.has(e.path)
        const icon = e.kind === 'dir' ? (open ? '📂' : '📁') : py ? '🐍' : '📄'
        return `<li>
          <button type="button" class="files-item${py || e.kind === 'dir' ? '' : ' is-other'}${e.path === this.current ? ' is-current' : ''}"
            data-path="${attr(e.path)}" data-kind="${e.kind}"
            ${e.kind === 'dir' ? `aria-expanded="${open}"` : ''}${py || e.kind === 'dir' ? '' : ' aria-disabled="true"'}
            ${e.path === this.current ? 'aria-current="true"' : ''}><span aria-hidden="true">${icon}</span> ${esc(e.name)}</button>
          ${e.kind === 'dir' ? `<ul class="files-sub"${open ? '' : ' hidden'}></ul>` : ''}
        </li>`
      })
      .join('')
    for (const sub of list.querySelectorAll(':scope > li > .files-sub:not([hidden])')) {
      await this._fill(sub, sub.previousElementSibling.dataset.path)
    }
  }

  async _click(e) {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'pick') {
      if (await this.store.pickFolder()) {
        this.expanded.clear()
        await this.render()
      }
    } else if (act === 'reopen') {
      if (await this.store.reopen()) await this.render()
    } else if (act === 'new') {
      const form = this.host.querySelector('.files-form')
      form.hidden = false
      form.querySelector('.files-error').textContent = ''
      form.querySelector('.files-name').value = ''
      form.querySelector('.files-name').focus()
    } else if (act === 'cancel') {
      this.host.querySelector('.files-form').hidden = true
      this.host.querySelector('.files-new').focus()
    }
    const item = e.target.closest('.files-item')
    if (!item || item.getAttribute('aria-disabled') === 'true') return
    if (item.dataset.kind === 'dir') {
      const path = item.dataset.path
      const open = !this.expanded.has(path)
      if (open) this.expanded.add(path)
      else this.expanded.delete(path)
      item.setAttribute('aria-expanded', String(open))
      item.firstElementChild.textContent = open ? '📂' : '📁'
      const sub = item.nextElementSibling
      sub.hidden = !open
      if (open) await this._fill(sub, path)
    } else {
      await this.open(item.dataset.path)
    }
  }

  async _createFromForm() {
    const form = this.host.querySelector('.files-form')
    const error = form.querySelector('.files-error')
    let name = form.querySelector('.files-name').value.trim()
    if (name && !/\.py$/i.test(name)) name += '.py'
    if (!/^[\w][\w\- ]*\.py$/i.test(name)) {
      error.textContent = t('files.badName')
      return
    }
    if (await this.store.exists(name)) {
      error.textContent = t('files.exists', { name })
      return
    }
    await this.create(name)
    await this.render()
  }
}

function esc(text) {
  return String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

function attr(text) {
  return esc(text).replace(/"/g, '&quot;')
}
