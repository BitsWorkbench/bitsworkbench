/** Toasts and the one modal dialog, kept deliberately small and warm. */
import { t } from '../i18n/index.js'

const EMOJI = { info: '💚', warn: '💛', error: '🧡' }
const LIFETIME = { info: 4000, warn: 7000, error: 9000 }

export function toast({ kind = 'info', title, detail } = {}) {
  const stack = document.getElementById('toast-stack')
  if (!stack) return

  const el = document.createElement('div')
  el.className = 'toast'
  el.dataset.kind = kind
  el.innerHTML = `
    <span class="toast-emoji" aria-hidden="true">${EMOJI[kind] || EMOJI.info}</span>
    <span class="toast-body">
      <strong class="toast-title"></strong>
      ${detail ? '<span class="toast-detail"></span>' : ''}
    </span>`
  el.querySelector('.toast-title').textContent = title
  if (detail) el.querySelector('.toast-detail').textContent = detail

  stack.appendChild(el)
  const remove = () => el.remove()
  el.addEventListener('click', remove)
  setTimeout(remove, LIFETIME[kind] || LIFETIME.info)
}

/**
 * The dialog with a button per choice: resolves with the `value` of the one
 * pressed, or null when it was closed another way (Escape). The `primary`
 * choice is the green one, and takes the focus.
 * @param {{title: string, bodyHtml: string, choices: {value: string, label: string, primary?: boolean}[]}} options
 * @returns {Promise<string|null>}
 */
export function choose({ title, bodyHtml, choices }) {
  const dialog = document.getElementById('modal')
  dialog.innerHTML = `
    <form method="dialog" class="modal-inner">
      <h2></h2>
      <div class="modal-body"></div>
      <div class="modal-actions modal-choices"></div>
    </form>`
  dialog.querySelector('h2').textContent = title
  dialog.querySelector('.modal-body').innerHTML = bodyHtml
  const row = dialog.querySelector('.modal-actions')
  for (const c of choices) {
    const b = document.createElement('button')
    b.className = c.primary ? 'btn' : 'btn btn-ghost'
    b.value = `choice:${c.value}`
    b.textContent = c.label
    row.append(b)
  }
  // Escape leaves returnValue as the last dialog set it.
  dialog.returnValue = ''
  dialog.showModal()
  row.querySelector('.btn:not(.btn-ghost)')?.focus()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue.startsWith('choice:') ? dialog.returnValue.slice(7) : null), { once: true })
  })
}

/**
 * @param {{title: string, bodyHtml: string, confirmText?: string,
 *          cancelText?: string}} options
 * @returns {Promise<boolean>} true when confirmed
 */
export function showModal({ title, bodyHtml, confirmText = t('modal.ok'), cancelText }) {
  const dialog = document.getElementById('modal')
  dialog.innerHTML = `
    <form method="dialog" class="modal-inner">
      <h2></h2>
      <div class="modal-body"></div>
      <div class="modal-actions">
        ${cancelText ? `<button class="btn btn-ghost" value="cancel"></button>` : ''}
        <button class="btn" value="ok"></button>
      </div>
    </form>`
  dialog.querySelector('h2').textContent = title
  dialog.querySelector('.modal-body').innerHTML = bodyHtml
  dialog.querySelector('button[value="ok"]').textContent = confirmText
  if (cancelText) dialog.querySelector('button[value="cancel"]').textContent = cancelText

  dialog.showModal()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true })
  })
}
