/**
 * Blockly's own blocks, writing the Python a student would. the app is
 * blocks that grow into real Python, and Python comes back to blocks, so a
 * block writes what a student would type, not Blockly's defensive forms.
 */
import { pythonGenerator, Order } from 'blockly/python'
import { value } from './define.js'

// Blockly: `x = (x if isinstance(x, Number) else 0) + 1`.
pythonGenerator.forBlock.math_change = (block, gen) => {
  const name = gen.getVariableName(block.getFieldValue('VAR'))
  const delta = value(gen, block, 'DELTA', '0', Order.NONE)
  // "change by -1" is `x -= 1`, as it would be typed.
  return /^-\d+(\.\d+)?$/.test(delta) ? `${name} -= ${delta.slice(1)}\n` : `${name} += ${delta}\n`
}

// Blockly, for three or more: `''.join([str(x) for x in [a, b, c]])`.
// Here every join is `'a' + str(b) + 'c'`: text as it is, anything else in str().
pythonGenerator.forBlock.text_join = (block, gen) => {
  const parts = []
  for (let i = 0; i < block.itemCount_; i++) {
    const target = block.getInputTargetBlock(`ADD${i}`)
    const code = gen.valueToCode(block, `ADD${i}`, Order.NONE) || "''"
    parts.push(target?.type === 'text' ? code : `str(${code})`)
  }
  if (!parts.length) return ["''", Order.ATOMIC]
  if (parts.length === 1) return [parts[0], Order.FUNCTION_CALL]
  return [parts.join(' + '), Order.ADDITIVE]
}
