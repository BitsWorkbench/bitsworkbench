/**
 * The palettes' size, for small screens: full, or small, where each category
 * of the block palette and the Python palette shows only its colour and its
 * emoji. A small category keeps its name for screen readers, and shows it as
 * a tooltip. One button at the palettes' foot switches both; this browser
 * remembers which.
 */
import { t } from '../i18n/index.js'

const KEY = 'opencodebot.palette.v1' // 'small', or nothing for full

/**
 * `root`, the element holding both palettes; `button`, the switch;
 * `onChange()` after the size changes, for the editor to fit again.
 */
export function installPaletteSize({ root, button, onChange }) {
  let small = false
  try {
    small = localStorage.getItem(KEY) === 'small'
  } catch {
    // Storage blocked: full size, every time.
  }

  // The categories are drawn again when the board, a CodeTrek or My blocks changes.
  const label = () => {
    for (const el of root.querySelectorAll('.blocklyToolboxCategory, .py-cat')) {
      if (small) el.title = el.textContent.trim()
      else el.removeAttribute('title')
    }
  }
  const watch = new MutationObserver(label)
  const watched = new Set()
  const observe = () => {
    for (const el of root.querySelectorAll('.blocklyToolbox, .blocklyToolboxDiv, .py-cats')) {
      if (watched.has(el)) continue
      watched.add(el)
      watch.observe(el, { childList: true, subtree: true })
    }
  }

  const apply = () => {
    root.dataset.palette = small ? 'small' : 'full'
    const name = t(small ? 'palette.bigger' : 'palette.smaller')
    button.textContent = small ? '»' : '«'
    button.setAttribute('aria-label', name)
    button.title = name
    observe()
    label()
    onChange()
  }

  button.addEventListener('click', () => {
    small = !small
    try {
      if (small) localStorage.setItem(KEY, 'small')
      else localStorage.removeItem(KEY)
    } catch {
      // Storage blocked: it holds until the page reloads.
    }
    apply()
  })
  apply()
}
