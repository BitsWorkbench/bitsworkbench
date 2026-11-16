/**
 * The Python palette: the blocks' palette, category for category, with each
 * block shown as the Python it makes. The code comes from the block
 * generator itself, so a snippet always matches its block; a few general
 * blocks whose bare Python reads poorly are written out by hand instead.
 *
 * A snippet: { code, line, imports, setup, colour }. `line` is true for a statement
 * (it takes whole lines) and false for a value (it goes inside a line).
 * `imports` and `setup` are the lines the program needs for it to run.
 */
import * as Blockly from 'blockly/core'
import { pythonGenerator } from 'blockly/python'
import { toolboxFor } from '../blocks/index.js'
import { HUE } from '../blocks/theme.js'
import { importLines, setupLines } from '../blocks/generate.js'
import { resetNeeds, allNeeds } from '../blocks/context.js'

const line = (code) => ({ code, line: true })
const value = (code) => ({ code, line: false })

/** Written by hand: what a student would type, not what an empty block makes. */
const BY_HAND = {
  ocb_on_start: null, // a program's top level needs no block
  ocb_python_value: null, // any piece of Python; nothing to show
  controls_whileUntil: line('while True:\n    pass'),
  controls_repeat_ext: line('for count in range(4):\n    pass'),
  controls_for: line('for i in range(1, 11):\n    pass'),
  controls_forEach: line('for item in items:\n    pass'),
  controls_flow_statements: line('break'),
  controls_if: line('if True:\n    pass'),
  logic_compare: value('a == b'),
  logic_operation: value('a and b'),
  logic_negate: value('not a'),
  lists_create_with: value('[1, 2, 3]'),
  lists_length: value('len(items)'),
  lists_getIndex: value('items[0]'),
  lists_setIndex: line('items[0] = 1'),
  text_join: value("'a' + 'b'"),
}

/** `controls_if` with an else is a second toolbox entry. */
const IF_ELSE = line('if True:\n    pass\nelse:\n    pass')

/** The Variables and Functions categories have no blocks of their own until made. */
const CUSTOM = {
  VARIABLE: [line('count = 0'), line('count += 1'), line('print(count)')],
  PROCEDURE: [line('def my_function():\n    pass'), line('my_function()'), line('def add(a, b):\n    return a + b')],
}

/**
 * The palette for a board: categories and separators, in the toolbox's order.
 * Category: { kind: 'category', name, colour, snippets }; separator: { kind: 'sep' }.
 */
export function snippetsFor(targetId) {
  const scratch = new Blockly.Workspace()
  try {
    return toolboxFor(targetId).contents.map((entry) => {
      if (entry.kind !== 'category') return { kind: 'sep' }
      const snippets = entry.custom
        ? CUSTOM[entry.custom].map(complete)
        : entry.contents.filter((item) => item.kind === 'block').map((item) => snippetOf(item, scratch)).filter(Boolean)
      const colour = HUE[entry.categorystyle.replace(/_category$/, '')]
      return { kind: 'category', name: entry.name, colour, snippets: snippets.map((s) => ({ ...s, colour })) }
    })
  } finally {
    scratch.dispose()
  }
}

const complete = (s) => ({ imports: [], setup: [], ...s })

function snippetOf(item, scratch) {
  if (item.type === 'controls_if' && item.extraState?.hasElse) return complete(IF_ELSE)
  if (item.type in BY_HAND) return BY_HAND[item.type] && complete(BY_HAND[item.type])
  scratch.clear()
  const block = Blockly.serialization.blocks.append({ type: item.type, inputs: item.inputs, extraState: item.extraState }, scratch)
  resetNeeds()
  pythonGenerator.init(scratch)
  const out = pythonGenerator.blockToCode(block)
  const needs = allNeeds()
  // Blockly's own blocks keep their imports (math, random) as definitions.
  const builtIn = Object.values(pythonGenerator.definitions_).filter((d) => /^(import|from) /.test(d))
  const imports = [...importLines(needs), ...builtIn]
  const setup = setupLines(needs)
  if (Array.isArray(out)) return { code: out[0], line: false, imports, setup }
  const code = out.replace(/\n+$/, '')
  return code ? { code, line: true, imports, setup } : null
}
