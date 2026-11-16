/** Registering every block definition, once, at startup. */
import './locale.js'
import 'blockly/blocks'
// Swaps the gear-and-bubble mutators (if/else if, join, list, function
// inputs) for plain + and - buttons on the block. Dragging tiny blocks around
// inside a bubble is where young students and teachers got stuck.
import '@blockly/block-plus-minus'
import { pythonGenerator } from 'blockly/python'

// Four spaces, so the code in the Python tab looks like the Python students
// will go on to write by hand.
pythonGenerator.INDENT = '    '
// A block's comment is written as the student wrote it, not re-wrapped, so
// it comes back the same from Python.
pythonGenerator.COMMENT_WRAP = Infinity

import './builtins.js'
import './comments.js'
import './basics.js'
import './codex.js'
import './codebot.js'
import './codeair.js'
import './radio.js'

export { toolboxFor } from './toolbox.js'
export { cuteTheme } from './theme.js'
export { generatePython, generateWithLines, highlightPython, devicesUsed, boardOfPython } from './generate.js'
