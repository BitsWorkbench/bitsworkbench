/**
 * Every string a student or teacher sees, in one table per language
 * (src/i18n/<lang>.js), looked up by key. How to add a string or a language:
 * README.md, "Strings and languages".
 *
 *   t('status.ready')                         → "Ready"
 *   t('run.wrongDevice', { names, device })   → placeholders in {braces}
 *   t('sim.robots', { count: 3 })             → { one, other } by count
 *
 * The language is settled once, when this module loads: `?lang=` in the
 * address, then the one saved by setLanguage(), then the browser's own
 * languages, then English. Changing it reloads the page, so tables built at
 * load time (the toolbox, the device list) need no rebuilding. A key missing
 * from a language falls back to English, and a key missing from English shows
 * as the key itself, so a gap is visible rather than blank.
 *
 * `?lang=en-XA` is a pseudo-language for testing: English with every letter
 * accented and each string in ⟦ ⟧. Text that shows up plain was not looked up
 * here (tests/pseudo.mjs checks the whole app this way).
 */
import { BRAND } from '../brand.js'
import en from './en.js'

/**
 * The languages a person can pick: each one's name for itself and, for one
 * translated by machine and not yet checked by a person, its own few words
 * saying so (shown under its name in the menu; while it is in use, the menu
 * adds lang.improve and About opens with about.machineHtml). Set `machine`
 * to '' once a person has reviewed it. Here rather than in the tables, so the
 * menu can offer a language without loading it.
 */
const OFFERED = {
  en: { name: 'English', machine: '' },
  es: { name: 'Español', machine: 'traducción automática' },
}
// A table other than English loads only when it is the language in use: the
// first visit has a download budget (tests/lazy-parts.mjs).
const LOAD = { es: () => import('./es.js') }
const SAVED = 'opencodebot.lang.v1'
export const PSEUDO = 'en-XA'

/** The languages a person can pick, each named in its own language. */
export const LANGUAGES = Object.keys(OFFERED)
export const language = pick()
const table = await load(language)

// The language's table, or English if it cannot load (a page left on an old
// build whose parts are gone): words in English rather than no page.
async function load(lang) {
  try {
    return LOAD[lang] ? (await LOAD[lang]()).default : en
  } catch {
    return en
  }
}

const plural = new Intl.PluralRules(language)
const number = new Intl.NumberFormat(language)
const list = new Intl.ListFormat(language, { type: 'conjunction' })

/** A language's own name for itself: "Español". */
export function languageName(lang) {
  return OFFERED[lang]?.name ?? lang
}

/** A language's own few words saying it was translated by machine ("traducción automática"), or '' when a person made or checked it. */
export function machineNote(lang) {
  return OFFERED[lang]?.machine ?? ''
}

/** A number with exactly `digits` decimals, as the language writes it: "0.5". */
export function fixed(value, digits) {
  return new Intl.NumberFormat(language, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Items joined as the language joins a list: "CodeX and CodeAIR". */
export function listOf(items) {
  return list.format(items.map(String))
}

function pick() {
  const wanted = []
  try {
    wanted.push(new URL(globalThis.location?.href).searchParams.get('lang'))
  } catch { /* not in a browser */ }
  try {
    wanted.push(globalThis.localStorage?.getItem(SAVED))
  } catch { /* storage blocked */ }
  wanted.push(...(globalThis.navigator?.languages ?? []))
  for (const tag of wanted) {
    if (!tag) continue
    if (tag === PSEUDO) return tag
    if (OFFERED[tag]) return tag
    const base = tag.split('-')[0]
    if (OFFERED[base]) return base
  }
  return 'en'
}

/** Save a language for next time and reload into it. */
export function setLanguage(lang) {
  const url = new URL(location.href)
  url.searchParams.delete('lang') // or the address would win over the choice
  try {
    localStorage.setItem(SAVED, lang)
  } catch {
    url.searchParams.set('lang', lang) // storage blocked: carry it in the address
  }
  location.assign(url)
}

/**
 * The string for `key`, with `params` put into its {placeholders}. Numbers are
 * formatted for the language. A key ending in `Html` is HTML: its params are
 * escaped. `{app}` is always the product's name and `{issues}` where to report
 * a problem (src/brand.js), unless the caller passes its own.
 */
export function t(key, params = {}) {
  let s = table[key] ?? en[key] ?? key
  if (typeof s === 'object') s = s[plural.select(params.count ?? 0)] ?? s.other
  if (language === PSEUDO && s !== key) s = pseudo(s)
  const html = key.endsWith('Html')
  return s.replace(/\{(\w+)\}/g, (whole, name) => {
    const v = name in params ? params[name] : name === 'app' ? t('app.name') : name === 'issues' ? BRAND.issues : undefined
    if (v === undefined) return whole
    const text = typeof v === 'number' ? number.format(v) : String(v)
    return html ? escapeHtml(text) : text
  })
}

/** A string made safe to put in HTML markup, for templates built in code. */
export function tHtml(key, params) {
  return escapeHtml(t(key, params))
}

/**
 * Fill the page's own markup from the table:
 *   data-i18n="key"                      its text
 *   data-i18n-html="key"                 its HTML (a key ending in Html)
 *   data-i18n-attr="title=key;aria-label=key"   attributes
 */
export function translatePage(root = document) {
  document.documentElement.lang = language
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml)
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(';')) {
      const [attr, key] = pair.split('=').map((s) => s.trim())
      if (attr && key) el.setAttribute(attr, t(key))
    }
  }
}

const ACCENTED = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ṁ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}

/**
 * A string in the pseudo-language: every letter accented, the whole in ⟦ ⟧.
 * What the code fills in or reads is left alone: {placeholders}, Blockly's %1
 * and %{BKY_...}, HTML tags and entities.
 */
export function pseudo(s) {
  if (typeof s !== 'string' || !s.trim()) return s
  const body = s.replace(/(\{\w+\}|%\{\w+\}|%\d+|<[^>]*>|&#?\w+;)|([A-Za-z])/g, (m, keep, letter) =>
    keep ?? ACCENTED[letter],
  )
  return `⟦${body}⟧`
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
