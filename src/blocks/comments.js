/**
 * Comments, written where the student had them. A block's comment is
 * written as `# ` lines above its Python, as Blockly does; a comment that
 * ended a line of Python goes back at the end of the block's first line. The
 * block keeps that line's text in its `data`, so a comment changed in block
 * mode goes above again. Workspace notes (comments on no block) are written
 * after the program.
 */
import * as Blockly from 'blockly/core'
import { pythonGenerator } from 'blockly/python'

/** The `data` a block keeps for a comment that ends its first line. */
export function endOfLineData(text) {
  return JSON.stringify({ commentAtEnd: text })
}

/** The text of a block's comment that ends its first line, or null. */
function atEnd(block, comment) {
  let saved
  try {
    saved = JSON.parse(block.data || 'null')?.commentAtEnd
  } catch {
    return null
  }
  if (typeof saved !== 'string') return null
  const last = comment.split('\n').pop()
  return last === saved ? saved : null
}

/** `# text`, as a comment line is written. */
const hash = (text) => (text ? `# ${text}` : '#')

/** The code with a comment at the end of its first line of code. */
function onFirstLine(code, text) {
  const lines = code.split('\n')
  // A marker line the generator adds (generateWithLines) is not code.
  const k = lines.findIndex((l) => !/^\s*#/.test(l) && l.trim())
  if (k < 0) return null
  lines[k] = `${lines[k]}  ${hash(text)}`
  return lines.join('\n')
}

/** Blockly's scrub_, with a comment that ended a line put back at its end. */
pythonGenerator.scrub_ = function (block, code, thisOnly = false) {
  let above = ''
  if (!block.outputConnection || !block.outputConnection.targetConnection) {
    const comment = block.getCommentText()
    if (comment) {
      const lines = comment.split('\n')
      const end = atEnd(block, comment)
      const placed = end !== null && code ? onFirstLine(code, end) : null
      if (placed !== null) {
        code = placed
        lines.pop()
      }
      if (lines.length) above += lines.map(hash).join('\n') + '\n'
    }
    // The comments of the value blocks in its slots, as Blockly writes them.
    for (const input of block.inputList) {
      if (input.type !== Blockly.inputs.inputTypes.VALUE) continue
      const child = input.connection.targetBlock()
      const nested = child && this.allNestedComments(child)
      if (nested) above += this.prefixLines(nested, '# ')
    }
  }
  const next = block.nextConnection && block.nextConnection.targetBlock()
  return above + code + (thisOnly ? '' : this.blockToCode(next))
}

/** The workspace's notes as Python comments, top to bottom: one string, or ''. */
export function notesPython(workspace) {
  const notes = (workspace.getTopComments?.() || [])
    .map((c) => ({ text: c.getText(), at: c.getRelativeToSurfaceXY() }))
    .filter((n) => n.text.trim())
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)
  return notes.map((n) => n.text.split('\n').map(hash).join('\n')).join('\n\n')
}
