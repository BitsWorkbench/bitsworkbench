/**
 * Blockly's own words (its built-in blocks, menus, the toolbox's labels) in
 * the app's language. Imported before any block is defined.
 */
import * as Blockly from 'blockly/core'
import * as En from 'blockly/msg/en'
import { language, PSEUDO, pseudo } from '../i18n/index.js'

// A language other than English loads only when it is in use (the first
// visit's budget, as the app's own tables in i18n/index.js).
const BLOCKLY = { es: () => import('blockly/msg/es') }

// Importing blockly/core on its own leaves the message table empty, which
// breaks everything from tooltips to the toolbox's aria labels. English
// first, so anything a translation leaves out still has words.
Blockly.setLocale(En)
if (BLOCKLY[language]) {
  try {
    const msgs = await BLOCKLY[language]()
    Blockly.setLocale(msgs.DELETE_BLOCK ? msgs : msgs.default) // loaded on demand, it may come wrapped
  } catch {
    // gone with an old build: English words, from above
  }
}
if (language === PSEUDO) {
  for (const [name, text] of Object.entries(Blockly.Msg)) {
    // A message that only points at another (%{BKY_...}) gets its words there.
    if (typeof text === 'string' && !/^%\{BKY_\w+\}$/.test(text)) Blockly.Msg[name] = pseudo(text)
  }
}
