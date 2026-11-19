/**
 * A pack's Markdown as HTML, for the tutorial pane. A pack comes from outside,
 * so no HTML of its own gets through: markdown-it escapes it, links go only
 * to http(s) and open in a new tab, and an image is only one of the pack's
 * own, by name. On top of Markdown, the format's sections
 * (docs/mission-packs.md): --Blocks-- and --Python-- keep what is for the
 * mode the student is in; the others become panels.
 */
import MarkdownIt from 'markdown-it'
import { BRAND } from '../brand.js'

const md = new MarkdownIt({ html: false, linkify: false, typographer: false })

/** Text made safe to put in HTML, attributes included. */
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

md.validateLink = (url) => /^https?:\/\//i.test(url) || /^[\w.-]+$/.test(url)
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  const token = tokens[i]
  if (!/^https?:\/\//i.test(token.attrGet('href') || '')) return '<a>'
  token.attrSet('target', '_blank')
  token.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, i, options)
}
md.renderer.rules.image = (tokens, i, options, env) => {
  const token = tokens[i]
  const src = env.assets?.[token.attrGet('src')]
  if (!src) return ''
  return `<img src="${esc(src)}" alt="${esc(token.content)}">`
}

const MARKER = /--(\/?)([A-Za-z]+)([^\n]*?)(\/?)--/g

/**
 * HTML for `text`. `mode` is 'blocks' or 'python'; `assets` the pack's images
 * by name; `label(name, title)` the words for a section's heading (a File
 * section's is the whole sentence, with the file's name as `title`).
 */
export function renderMarkdown(text, { mode, assets = {}, label = (name) => name }) {
  const env = { assets }
  // {app} is the product's name (src/brand.js), so a pack never writes it.
  const shown = forMode(text, mode).replaceAll('{app}', BRAND.name)
  let html = ''
  let rest = shown
  // Sections are block-level: the Markdown between them renders on its own.
  for (;;) {
    MARKER.lastIndex = 0
    const m = MARKER.exec(rest)
    if (!m) break
    html += md.render(rest.slice(0, m.index), env)
    const [whole, close, name, args] = m
    rest = rest.slice(m.index + whole.length)
    if (close) continue // a stray close: the reader refuses these, so nothing to show
    if (name === 'File') {
      const title = /title=\{([^}]+)\}/.exec(args)?.[1] ?? ''
      html += `<p class="lsec lsec-file"><span aria-hidden="true">📄</span> ${esc(label('File', title))}</p>`
      continue
    }
    const end = findClose(rest, name)
    const inner = end ? rest.slice(0, end.index) : rest
    rest = end ? rest.slice(end.index + end.length) : ''
    const body = renderMarkdown(inner, { mode, assets, label })
    const kind = name.toLowerCase()
    html +=
      name === 'Peek'
        ? `<details class="lsec lsec-peek"><summary>${esc(label(name))}</summary>${body}</details>`
        : `<div class="lsec lsec-${kind}"><p class="lsec-label">${esc(label(name))}</p>${body}</div>`
  }
  return html + md.render(rest, env)
}

/** The text with the other mode's sections taken out and this mode's opened up, inline or not. */
function forMode(text, mode) {
  const keep = mode === 'blocks' ? 'Blocks' : 'Python'
  const drop = keep === 'Blocks' ? 'Python' : 'Blocks'
  return text.replace(new RegExp(`--${drop}--[\\s\\S]*?--/${drop}--`, 'g'), '').replace(new RegExp(`--/?${keep}--`, 'g'), '')
}

/** Where the section `name` that opened just before `text` closes, minding sections of the same name inside it. */
function findClose(text, name) {
  const re = new RegExp(`--(/?)${name}--`, 'g')
  let depth = 0
  for (let m; (m = re.exec(text)); ) {
    if (!m[1]) depth++
    else if (depth-- === 0) return { index: m.index, length: m[0].length }
  }
  return null
}
