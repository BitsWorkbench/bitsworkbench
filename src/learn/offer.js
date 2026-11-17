/**
 * Whether an objective is taught in blocks. Blocks are offered when its code
 * becomes real blocks: at most a quarter of the code's lines left as grey
 * Python blocks (docs/mission-packs.md, `blocks`). The code judged is the
 * objective's solution, else its starting code, else its CodeTrek: the program
 * the student ends up with. An objective's own `blocks` decides over this.
 */

/** The most of an objective's code that may stay grey Python blocks, as a share of its lines. */
export const MOST_GREY = 0.25

/** The program an objective builds toward, as Python, or '' when it has none. */
export function programOf(objective) {
  return objective.solution || objective.code || (objective.trek || []).map((chunk) => chunk.python).join('\n')
}

/**
 * The lines that count: not blank, not a comment, not an import (the blocks
 * make their own imports), by number from 1.
 */
export function codeLines(python) {
  return python
    .split('\n')
    .map((line, i) => [i + 1, line.trim()])
    .filter(([, line]) => line && !line.startsWith('#') && !/^(from|import)\s/.test(line))
    .map(([n]) => n)
}

/**
 * The share of the program's lines left as grey Python blocks, 0 to 1; null
 * when it does not parse. `convert(python)` is the app's Python to blocks,
 * `{ ok, pythonLines }`.
 */
export function greyShare(python, convert) {
  const lines = codeLines(python)
  if (!lines.length) return 0
  const result = convert(python)
  if (!result.ok) return null
  const grey = new Set(result.pythonLines)
  return lines.filter((n) => grey.has(n)).length / lines.length
}

/**
 * Whether the objective is offered in blocks. `convert(python, board)` turns
 * Python into blocks for a board; `board` is the objective's.
 */
export function offersBlocks(objective, board, convert) {
  if (typeof objective.blocks === 'boolean') return objective.blocks
  const share = greyShare(programOf(objective), (python) => convert(python, board))
  return share !== null && share <= MOST_GREY
}
