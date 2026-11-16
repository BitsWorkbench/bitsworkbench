/** Blocks every board shares: starting, waiting, repeating, printing. */
import { Order } from 'blockly/python'
import { registerFieldMultilineInput } from '@blockly/field-multilineinput'
import { parser } from '@lezer/python'
import { msg, defineBlocks, value, body } from './define.js'

registerFieldMultilineInput()
import { need } from './context.js'

export const COLOR_CHOICES = [
  [msg('block.opt.red'), 'RED'],
  [msg('block.opt.orange'), 'ORANGE'],
  [msg('block.opt.yellow'), 'YELLOW'],
  [msg('block.opt.green'), 'GREEN'],
  [msg('block.opt.dark_green'), 'DARK_GREEN'],
  [msg('block.opt.cyan'), 'CYAN'],
  [msg('block.opt.blue'), 'BLUE'],
  [msg('block.opt.dark_blue'), 'DARK_BLUE'],
  [msg('block.opt.purple'), 'PURPLE'],
  [msg('block.opt.magenta'), 'MAGENTA'],
  [msg('block.opt.pink'), 'PINK'],
  [msg('block.opt.brown'), 'BROWN'],
  [msg('block.opt.white'), 'WHITE'],
  [msg('block.opt.gray'), 'GRAY'],
  [msg('block.opt.off_black'), 'BLACK'],
]

defineBlocks([
  {
    json: {
      type: 'ocb_on_start',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'start_hat',
      helpUrl: '',
    },
    python: (block, gen) =>
      // The body is written at top level, so peel off exactly one indent step.
      gen.statementToCode(block, 'DO').replace(new RegExp(`^${gen.INDENT}`, 'gm'), ''),
  },

  {
    json: {
      type: 'ocb_forever',
      message1: '%1',
      args1: [{ type: 'input_statement', name: 'DO' }],
      style: 'loop_hat',
    },
    python: (block, gen) => `while True:\n${body(gen, block)}`,
  },

  {
    json: {
      type: 'ocb_wait',
      args0: [{ type: 'input_value', name: 'SECS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'SECS', '1', Order.NONE)})\n`
    },
  },

  // Not in the palette (waits are in seconds, fractions welcome); kept so a
  // saved program that has one still loads and runs.
  {
    json: {
      type: 'ocb_wait_ms',
      args0: [{ type: 'input_value', name: 'MS', check: 'Number' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block, gen) => {
      need('time')
      return `time.sleep(${value(gen, block, 'MS', '100', Order.NONE)} / 1000)\n`
    },
  },

  {
    json: {
      type: 'ocb_print',
      args0: [{ type: 'input_value', name: 'TEXT' }],
      previousStatement: null,
      nextStatement: null,
      style: 'basics_blocks',
    },
    python: (block, gen) => `print(${value(gen, block, 'TEXT', "''", Order.NONE)})\n`,
  },

  {
    json: {
      type: 'ocb_color',
      message0: '%1',
      args0: [{ type: 'field_dropdown', name: 'COLOR', options: COLOR_CHOICES }],
      output: null,
      style: 'lights_blocks',
    },
    python: (block) => [block.getFieldValue('COLOR'), Order.ATOMIC],
  },

  {
    json: {
      type: 'ocb_rgb',
      args0: [
        { type: 'input_value', name: 'R', check: 'Number' },
        { type: 'input_value', name: 'G', check: 'Number' },
        { type: 'input_value', name: 'B', check: 'Number' },
      ],
      inputsInline: true,
      output: null,
      style: 'lights_blocks',
    },
    python: (block, gen) => {
      const r = value(gen, block, 'R', '0', Order.NONE)
      const g = value(gen, block, 'G', '0', Order.NONE)
      const b = value(gen, block, 'B', '0', Order.NONE)
      return [`(${r}, ${g}, ${b})`, Order.ATOMIC]
    },
  },

  {
    json: {
      type: 'ocb_seconds_since_start',
      output: 'Number',
      style: 'basics_blocks',
    },
    python: () => {
      need('time')
      return ['time.monotonic()', Order.FUNCTION_CALL]
    },
  },

  // Python with no block of its own: typed into the block, or kept from
  // Python that came back to blocks. Any number of lines.
  {
    json: {
      type: 'ocb_python',
      args0: [{ type: 'field_multilinetext', name: 'CODE', text: 'print("hi")', spellcheck: false }],
      previousStatement: null,
      nextStatement: null,
      style: 'python_blocks',
    },
    python: (block) => `${block.getFieldValue('CODE')}\n`,
  },
  {
    json: {
      type: 'ocb_python_value',
      args0: [{ type: 'field_input', name: 'CODE', text: 'max(1, 2)', spellcheck: false }],
      output: null,
      style: 'python_blocks',
    },
    // Bracketed where the code around it binds tighter, unless it is one
    // piece already (a name, a call, a string): `2 * (a + b)` stays right.
    python: (block) => {
      const code = block.getFieldValue('CODE')
      return [code, isAtom(code) ? Order.ATOMIC : Order.NONE]
    },
  },
])

/** One piece of Python that never needs brackets around it. */
function isAtom(code) {
  const top = parser.parse(code).topNode.firstChild?.firstChild
  return !!top && top.from === 0 && top.to === code.trim().length && ATOMS.has(top.name)
}

const ATOMS = new Set([
  'VariableName', 'CallExpression', 'MemberExpression', 'SubscriptExpression', 'Number', 'String',
  'FormatString', 'Boolean', 'None', 'ParenthesizedExpression', 'ArrayExpression', 'DictionaryExpression',
  'TupleExpression', 'SetExpression', 'ArrayComprehensionExpression', 'DictionaryComprehensionExpression',
])
