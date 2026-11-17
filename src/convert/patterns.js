/**
 * The way back from Python to a block is read off the block's own generator.
 * Each block type is generated once per choice in its dropdowns, with a
 * placeholder plugged into every input and a marker in every typed field;
 * the Python that comes out, parsed, is the block's pattern. A new block gets
 * its way back for free, and it can never disagree with its own Python.
 *
 * Placeholders, as they appear in a pattern's Python:
 *   __v_NAME__   a value input           (any expression; converted in turn)
 *   __s_NAME__   a statement input       (the body's statements)
 *   zqNAMEzq     a typed text field      (inside a string, or a token)
 *   98765+i      a number field
 *   zqvNAMEzq    a variable field
 */
import * as Blockly from 'blockly/core'
import { pythonGenerator, Order } from 'blockly/python'
import { toolboxFor } from '../blocks/index.js'
import { resetNeeds } from '../blocks/context.js'
import { omittable } from '../blocks/define.js'
import { tree, unwrap, statementsOf } from './tree.js'

// Stand-ins plugged into inputs while a pattern is generated. Never in a toolbox.
Blockly.defineBlocksWithJsonArray([
  { type: 'rt_value', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'NAME' }], output: null },
  {
    type: 'rt_statement',
    message0: '%1',
    args0: [{ type: 'field_label_serializable', name: 'NAME' }],
    previousStatement: null,
    nextStatement: null,
  },
])
pythonGenerator.forBlock.rt_value = (block) => [`__v_${block.getFieldValue('NAME')}__`, Order.ATOMIC]
pythonGenerator.forBlock.rt_statement = (block) => `__s_${block.getFieldValue('NAME')}__\n`

/** Blocks whose way back is written by hand, or which have none. */
const NOT_GENERIC = new Set([
  'ocb_on_start', // the program's top level
  'ocb_forever', // a last `while True:` at top level
  'ocb_python', // what anything with no block becomes
  'ocb_python_value',
  'ocb_todo', // `pass  # TODO: ...`, its text in the comment: to-blocks.js todoAt
  // Blockly's own blocks whose Python is not one fixed shape (a mutator, any
  // number of items, a loop variable): their way back is written by hand.
  'controls_if', // to-blocks.js HAND
  'controls_repeat_ext', // to-blocks.js HAND
  'controls_for', // to-blocks.js HAND
  'lists_create_with',
  'lists_getIndex',
  'lists_setIndex',
  'lists_length',
  'text_join',
])

/** At most this many dropdown combinations for one block. */
const MAX_COMBOS = 256

const NUMBER_BASE = 98765

/**
 * Patterns for a board: { statements, values, shadows }. The first two are
 * lists of { type, fields, extraState, inputs, stmts | expr, size, comment,
 * shadows }, most specific first; `shadows` maps each toolbox block type to
 * its inputs' defaults.
 */
export function patternsFor(targetId) {
  const ws = new Blockly.Workspace()
  const statements = []
  const values = []
  const shadows = {}
  try {
    for (const item of toolboxItems(targetId)) {
      shadows[item.type] ||= item.inputs || {}
      if (NOT_GENERIC.has(item.type)) continue
      for (const p of patternsOfItem(item, ws)) (p.expr ? values : statements).push(p)
    }
  } finally {
    ws.dispose()
  }
  // More statements first (five motor lines are one "drive for"), then the
  // pattern with more fixed code (`time.sleep(5 / 1000)` is "wait ms").
  statements.sort((a, b) => b.stmts.length - a.stmts.length || b.size - a.size)
  values.sort((a, b) => b.size - a.size)
  return { statements, values, shadows }
}

/** The blocks of the categories Blockly fills in itself. */
const CUSTOM_ITEMS = {
  VARIABLE: [
    { kind: 'block', type: 'variables_set' },
    { kind: 'block', type: 'math_change', inputs: { DELTA: { shadow: { type: 'math_number', fields: { NUM: 1 } } } } },
  ],
}

/** Every block in a board's toolbox, once per type and extra state. */
function toolboxItems(targetId) {
  const seen = new Set()
  const out = []
  for (const entry of toolboxFor(targetId).contents) {
    for (const item of entry.contents || CUSTOM_ITEMS[entry.custom] || []) {
      if (item.kind !== 'block') continue
      const key = item.type + JSON.stringify(item.extraState || {})
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

function patternsOfItem(item, ws) {
  ws.clear()
  const block = Blockly.serialization.blocks.append({ type: item.type, extraState: item.extraState }, ws)
  const inputs = {}
  const dropdowns = []
  const typed = []
  let n = 0
  for (const input of block.inputList) {
    if (input.connection && input.type === Blockly.inputs.inputTypes.VALUE) {
      const v = ws.newBlock('rt_value')
      v.setFieldValue(input.name, 'NAME')
      input.connection.connect(v.outputConnection)
      inputs[input.name] = { kind: 'value', check: input.connection.getCheck() }
    } else if (input.connection && input.type === Blockly.inputs.inputTypes.STATEMENT) {
      const s = ws.newBlock('rt_statement')
      s.setFieldValue(input.name, 'NAME')
      input.connection.connect(s.previousConnection)
      inputs[input.name] = { kind: 'statement' }
    }
    for (const field of input.fieldRow) {
      if (!field.name) continue
      // (A variable field is a kind of dropdown, so it is asked about first.)
      if (field instanceof Blockly.FieldVariable) {
        typed.push({ name: field.name, kind: 'variable', field, marker: `zqv${field.name}zq` })
      } else if (field instanceof Blockly.FieldDropdown) {
        dropdowns.push({ name: field.name, options: field.getOptions(false).map(([, v]) => v) })
      } else if (field instanceof Blockly.FieldNumber) {
        typed.push({ name: field.name, kind: 'number', field, marker: NUMBER_BASE + n++ })
      } else if (field instanceof Blockly.FieldTextInput) {
        typed.push({ name: field.name, kind: 'text', field })
      }
    }
  }
  const output = block.outputConnection ? { check: block.outputConnection.getCheck() } : null
  if (!output && !block.previousConnection) return []

  for (const t of typed) {
    if (t.kind === 'number') t.field.value_ = t.marker
    if (t.kind === 'variable') {
      const v = ws.getVariableMap().createVariable(t.marker)
      t.field.setValue(v.getId())
    }
  }
  const out = []
  for (const combo of combos(dropdowns)) {
    for (const [name, v] of Object.entries(combo)) block.setFieldValue(v, name)
    const pattern = patternOf(block, item, ws, typed, inputs, output, combo)
    if (pattern) out.push(pattern)
  }
  return out
}

/** Every combination of dropdown choices: [{ NAME: value, ... }]. */
function combos(dropdowns) {
  let all = [{}]
  for (const d of dropdowns) {
    const next = []
    for (const c of all) for (const v of d.options) next.push({ ...c, [d.name]: v })
    all = next.slice(0, MAX_COMBOS)
  }
  return all
}

/** Text field markers: a word, and failing that, bits (for a field the generator filters). */
// Bits fields keep only 1s and 0s and at most so many (8 for CodeBot's top
// LEDs, 5 for its line sensor LEDs): markers they let through, longest first.
const TEXT_MARKERS = [(name) => `zq${name}zq`, () => '10110100', () => '10110']

function patternOf(block, item, ws, typed, inputs, output, combo) {
  const texts = typed.filter((t) => t.kind === 'text')
  const fields = {}
  for (const t of typed) fields[t.name] = { kind: t.kind, marker: String(t.marker) }
  // Try each text marker until it shows in the code.
  for (let k = 0; k < TEXT_MARKERS.length; k++) {
    for (const t of texts) {
      t.field.setValue(TEXT_MARKERS[k](t.name))
      fields[t.name] = { kind: 'text', marker: TEXT_MARKERS[k](t.name) }
    }
    const code = generate(block, ws, output)
    if (texts.every((t) => code.includes(fields[t.name].marker)) || k === TEXT_MARKERS.length - 1) {
      if (!texts.every((t) => code.includes(fields[t.name].marker))) return null
      return build(code, item, inputs, output, combo, fields)
    }
  }
  return null
}

function generate(block, ws, output) {
  resetNeeds()
  pythonGenerator.init(ws)
  const code = pythonGenerator.blockToCode(block, true)
  return Array.isArray(code) ? code[0] : code
}

function build(code, item, inputs, output, combo, fields) {
  const { root, comments } = tree(output ? `(${code})\n` : code)
  if (root.error) return null
  const stmts = statementsOf(root)
  const base = {
    type: item.type,
    extraState: item.extraState,
    combo,
    fields,
    inputs,
    shadows: item.inputs || {},
    // Arguments the Python may leave out (define.js omittable).
    omit: omittable(item.type),
    output,
    code,
  }
  if (output) {
    if (stmts.length !== 1 || stmts[0].name !== 'ExpressionStatement') return null
    const expr = unwrap(stmts[0].children[0])
    // A pattern that is nothing but a placeholder would match anything.
    if (isSlot(expr, fields)) return null
    return { ...base, expr, size: size(expr) }
  }
  // A block's own end-of-line comment (a note's name) is part of its pattern.
  const comment = comments.length === 1 ? comments[0].text : null
  if (comments.length > 1) return null
  return { ...base, stmts, comment, size: stmts.reduce((s, x) => s + size(x), 0) }
}

/** A node that is only a placeholder: `__v_X__`. */
function isSlot(node, fields) {
  if (node.name !== 'VariableName') return false
  return /^__v_\w+__$/.test(node.text) || Object.values(fields).some((f) => f.marker === node.text)
}

/** How much fixed code a pattern has: nodes that are not placeholders. */
function size(node) {
  if (node.name === 'VariableName' && /^__[vs]_\w+__$/.test(node.text)) return 0
  return 1 + (node.children || []).reduce((s, c) => s + size(c), 0)
}

