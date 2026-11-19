/**
 * Turns the workspace into a complete, runnable CircuitPython program.
 *
 * Blocks only emit the line they are about; this assembles the imports and
 * one-time setup around them, in the order the firmware needs. (On CodeX,
 * `import radio` genuinely has to come before `from codex import *`.)
 */
import { pythonGenerator } from 'blockly/python'
import { resetNeeds, allNeeds } from './context.js'
import { getTarget } from '../device/targets.js'
import { notesPython } from './comments.js'
import { BRAND } from '../brand.js'

/**
 * A text as a Python string literal. Blockly's own writes a line break as a
 * backslash and a line break, which in Python joins the lines: `print("a\nb")`
 * came back from blocks as printing "ab". A line break is `\n` here, and a
 * carriage return and a NUL their escapes too, so the text means what it did.
 */
pythonGenerator.quote_ = (text) => {
  let s = text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\0/g, '\\x00')
  let q = "'"
  if (s.includes("'")) {
    if (s.includes('"')) s = s.replace(/'/g, "\\'")
    else q = '"'
  }
  return q + s + q
}

export const DEVICE_IMPORT = {
  codex: 'from codex import *',
  codebot: 'from botcore import *',
  codeair: 'from codeair import *',
}

const NEED_FOR_DEVICE = { codex: 'codex', codebot: 'botcore', codeair: 'codeair' }

/** The board a program's imports name (`from botcore import *` is a CodeBot), or null. */
export function boardOfPython(text) {
  for (const [board, module] of Object.entries(NEED_FOR_DEVICE)) {
    if (new RegExp(`^\\s*(from\\s+${module}\\s+import|import\\s+${module}\\b)`, 'm').test(text)) return board
  }
  return null
}

export const BANNER = `# Made with ${BRAND.name} 💚 Blocks in, Python out.`

export function generatePython(workspace, targetId) {
  resetNeeds()
  // The blocks' Python, then the notes on no block.
  const program = [pythonGenerator.workspaceToCode(workspace).trim(), notesPython(workspace)].filter(Boolean).join('\n\n')
  const needs = allNeeds()

  const header = [BANNER]
  const target = getTarget(targetId)
  if (target) header.push(`# Device: ${target.fullName}`)
  header.push('')
  header.push(...importLines(needs))
  const setup = setupLines(needs)

  if (!program) {
    return `${header.join('\n').trim()}\n\n# Add some blocks and press Run!\n`
  }

  return [header.join('\n').trim(), setup.join('\n'), program]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n')
}

/** The import lines a set of needs calls for, in the order the firmware needs. */
export function importLines(needs) {
  const lines = []
  // Radio reserves internal memory, so it must be imported first of all.
  if (needs.has('radio')) lines.push('import radio')
  // Driven by the blocks actually used, not by the picker: a project full of
  // CodeX blocks still generates CodeX imports if the picker says otherwise.
  for (const [key, line] of Object.entries(DEVICE_IMPORT)) {
    if (needs.has(NEED_FOR_DEVICE[key])) lines.push(line)
  }
  // CodeX's and CodeAIR's own modules bring the colours with them (`from colors import *`
  // inside), as CodeSpace's programs assume: the line is written only when neither is.
  if (needs.has('colors') && !needs.has('codex') && !needs.has('codeair')) lines.push('from colors import *')
  if (needs.has('flight')) lines.push('from flight import *')
  if (needs.has('songplayer')) lines.push('from songplayer import song_player')
  if (needs.has('time')) lines.push('import time')
  return lines
}

/** The one-time setup lines a set of needs calls for, after the imports. */
export function setupLines(needs) {
  return needs.has('motors_enable') ? ['motors.enable(True)'] : []
}

/**
 * The program, and the block each of its lines comes from: { code, blockAt }
 * where blockAt[n] is the id of the block that line n (from 1) belongs to,
 * for showing a running program's line on its blocks. The code is exactly
 * generatePython's: it is generated once more with a marker before each
 * statement, and the markers taken out again.
 */
export function generateWithLines(workspace, targetId) {
  const code = generatePython(workspace, targetId)
  const blockAt = []
  const saved = pythonGenerator.STATEMENT_PREFIX
  pythonGenerator.STATEMENT_PREFIX = '#@@%1\n'
  let marked
  try {
    marked = generatePython(workspace, targetId)
  } finally {
    pythonGenerator.STATEMENT_PREFIX = saved
  }
  const out = []
  let pending = null
  for (const line of marked.split('\n')) {
    const m = /^\s*#@@'(.*)'$/.exec(line)
    if (m) { pending = m[1]; continue }
    out.push(line)
    if (pending) { blockAt[out.length] = pending; pending = null }
    // A line with no marker (the rest of a statement's code, an `else:`)
    // belongs to the block before it.
    else if (blockAt[out.length - 1]) blockAt[out.length] = blockAt[out.length - 1]
  }
  return out.join('\n') === code ? { code, blockAt } : { code, blockAt: [] }
}

/** Devices whose blocks appear in a workspace, by block-type prefix. */
export function devicesUsed(workspace) {
  const used = new Set()
  for (const block of workspace.getAllBlocks(false)) {
    for (const id of Object.keys(DEVICE_IMPORT)) {
      if (block.type.startsWith(`${id}_`)) used.add(id)
    }
  }
  return used
}

/** Very small Python highlighter for the read-only "Python" tab. */
const KEYWORDS =
  'and|as|break|class|continue|def|elif|else|except|False|finally|for|from|if|' +
  'import|in|is|None|not|or|pass|raise|return|True|try|while|with'

export function highlightPython(source) {
  // One pass, so a keyword inside a string (or a span we just emitted) is
  // never re-highlighted.
  const token = new RegExp(
    `(#[^\\n]*)|('(?:[^'\\\\\\n]|\\\\.)*'|"(?:[^"\\\\\\n]|\\\\.)*")|\\b(${KEYWORDS})\\b|(\\b\\d+\\.?\\d*\\b)`,
    'g',
  )
  let out = ''
  let last = 0
  let match
  while ((match = token.exec(source))) {
    out += escapeHtml(source.slice(last, match.index))
    const cls = match[1] ? 'c' : match[2] ? 's' : match[3] ? 'k' : 'n'
    out += `<span class="${cls}">${escapeHtml(match[0])}</span>`
    last = token.lastIndex
  }
  return out + escapeHtml(source.slice(last))
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
