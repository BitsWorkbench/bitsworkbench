/**
 * Python, parsed with Lezer (the parser the code editor already uses), into a
 * small plain tree that is easy to compare: { name, text, children, from, to }.
 * Parentheses are dropped, since the blocks put them back where they are
 * needed, and comments are kept aside with their positions.
 */
import { parser } from '@lezer/python'

/** Tokens whose text is the whole of what they mean. */
const LEAVES = new Set(['Number', 'String', 'FormatString', 'Boolean', 'None', 'Comment'])

/**
 * { root, comments, source }: root is the Script, with `error` set to
 * { from, line } when the code does not parse; comments are
 * { text, from, to, line, ownLine } in order.
 */
export function tree(source) {
  const comments = []
  let error = null
  const build = (cursor) => {
    const node = { name: cursor.name, from: cursor.from, to: cursor.to, children: [] }
    if (cursor.type.isError && !error) error = { from: cursor.from, line: lineAt(source, cursor.from) }
    if (LEAVES.has(cursor.name) || !cursor.firstChild()) {
      node.text = source.slice(cursor.from, cursor.to)
      return node
    }
    do {
      if (cursor.name === 'Comment') {
        const lineStart = source.lastIndexOf('\n', cursor.from - 1) + 1
        comments.push({
          text: source.slice(cursor.from + 1, cursor.to).replace(/^ /, ''),
          from: cursor.from,
          to: cursor.to,
          line: lineAt(source, cursor.from),
          ownLine: !source.slice(lineStart, cursor.from).trim(),
        })
        continue
      }
      const child = build(cursor)
      if (child.name === 'ParenthesizedExpression') node.children.push(unwrap(child))
      else node.children.push(child)
    } while (cursor.nextSibling())
    cursor.parent()
    return node
  }
  const root = build(parser.parse(source).cursor())
  if (error) {
    // The parser trips where the code stops making sense; for a bracket
    // never closed that is lines later. The bracket's own line is the one to fix.
    const open = unclosed(source)
    root.error = open !== null && open < error.from ? { from: open, line: lineAt(source, open) } : error
  }
  comments.sort((a, b) => a.from - b.from)
  return { root, comments, source }
}

/** The expression inside any number of parentheses. */
export function unwrap(node) {
  while (node.name === 'ParenthesizedExpression') {
    const inner = node.children.filter((c) => c.name !== '(' && c.name !== ')')
    if (inner.length !== 1) return node
    node = inner[0]
  }
  return node
}

/** The statements of a Script or a Body, in order. */
export function statementsOf(node) {
  return node.children.filter((c) => c.name !== ':' && c.name !== 'Comment')
}

/** Where the first bracket that is never closed opens, or null. */
function unclosed(source) {
  const stack = []
  const pairs = { ')': '(', ']': '[', '}': '{' }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '#') {
      while (i < source.length && source[i] !== '\n') i++
    } else if (c === '"' || c === "'") {
      const triple = source.startsWith(c.repeat(3), i)
      const end = triple ? c.repeat(3) : c
      i += end.length
      while (i < source.length && !source.startsWith(end, i)) {
        if (source[i] === '\\') i++
        else if (!triple && source[i] === '\n') break
        i++
      }
      i += end.length - 1
    } else if ('([{'.includes(c)) {
      stack.push({ c, at: i })
    } else if (c in pairs) {
      if (stack.at(-1)?.c === pairs[c]) stack.pop()
      else return null
    }
  }
  return stack.length ? stack[0].at : null
}

/** Line number (from 1) of a position. */
export function lineAt(source, pos) {
  let line = 1
  for (let i = 0; i < pos && i < source.length; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/** The node at a path of child indexes, for tests. */
export function nodeOf(root, ...path) {
  return path.reduce((n, i) => n.children[i], root)
}
