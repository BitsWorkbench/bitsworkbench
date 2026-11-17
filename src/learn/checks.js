/**
 * A goal's check (docs/mission-packs.md, "Checks"), against what the student
 * has done. Code checks read the program as Python through Lezer, so spaces,
 * quotes and parentheses do not matter; a pattern is a piece of Python where
 * `...` stands for anything. The other checks read what happened: runs,
 * things done in the app, and which of the pack's regular expressions the
 * output and the clicked parts have matched (the caller tests those, time-boxed:
 * see regex.js).
 */
import { tree } from '../convert/tree.js'

/** The single statement a pattern is, parsed once. */
const patterns = new Map()
function patternOf(source) {
  if (!patterns.has(source)) {
    const statement = tree(source).root.children[0]
    // A pattern that is an expression matches that expression anywhere.
    patterns.set(source, statement.name === 'ExpressionStatement' ? statement.children[0] : statement)
  }
  return patterns.get(source)
}

/** The program, parsed once per text. */
let parsed = { source: null, root: null }
function programOf(source) {
  if (parsed.source !== source) parsed = { source, root: tree(source).root }
  return parsed.root
}

/**
 * Is `check` met? `seen` is what has happened since the objective opened:
 * { program, runs: [{ ok, seconds }], events: [{ name, detail }],
 *   printed: Set of `prints` regexes a line of output matched,
 *   picked: Set of `pick` regexes a clicked part matched }.
 */
export function met(check, seen) {
  if ('all' in check) return check.all.every((c) => met(c, seen))
  if ('any' in check) return check.any.some((c) => met(c, seen))
  if ('has' in check) return hasMet(check, seen.program)
  if ('order' in check) return inOrder(check.order, seen.program)
  if ('prints' in check) return seen.printed.has(check.prints)
  if ('runs' in check) return seen.runs.some((r) => r.ok && r.seconds >= (check.seconds ?? 0))
  if ('event' in check) return seen.events.some((e) => e.name === check.event && (check.name === undefined || e.detail === check.name))
  if ('pick' in check) return seen.picked.has(check.pick)
  return false
}

/** Every regex in a check (with `prints` or `pick`), for the caller to test what happens against. */
export function regexesOf(check, kind) {
  if (check.all || check.any) return (check.all || check.any).flatMap((c) => regexesOf(c, kind))
  return kind in check ? [check[kind]] : []
}

function hasMet(check, program) {
  const root = program != null && programOf(program)
  if (!root || root.error) return false
  const found = matches(root, patternOf(check.has), check.in && patternOf(check.in)).length
  const max = check.max ?? Infinity
  // At least one, unless the check says how many: `"max": 0` asks for none.
  return found >= (check.min ?? Math.min(1, max)) && found <= max
}

function inOrder(list, program) {
  const root = program != null && programOf(program)
  if (!root || root.error) return false
  let after = -1
  for (const p of list) {
    const next = matches(root, patternOf(p)).find((n) => n.from > after)
    if (!next) return false
    after = next.from
  }
  return true
}

/** Every node in the program matching `pattern` (inside a node matching `within`, if given), in order. */
export function matches(root, pattern, within = null) {
  const out = []
  const walk = (node, inside) => {
    if ((!within || inside) && same(pattern, node)) out.push(node)
    const nowInside = inside || (within && same(within, node))
    for (const c of node.children) walk(c, nowInside)
  }
  walk(root, false)
  return out
}

const PUNCTUATION = new Set(['(', ')', ',', ':', '.', '[', ']', '{', '}'])
const parts = (node) => node.children.filter((c) => !PUNCTUATION.has(c.name))
const isEllipsis = (n) => n.name === 'Ellipsis' || (n.name === 'ExpressionStatement' && n.children.length === 1 && n.children[0].name === 'Ellipsis')
// Statements whose clauses a pattern may stop short of: `if a: ...` matches an `if` with an `else`.
const CLAUSED = new Set(['IfStatement', 'TryStatement', 'ForStatement', 'WhileStatement'])

/** Does program node `n` match pattern node `p`? */
export function same(p, n) {
  if (isEllipsis(p)) return true
  if (p.name !== n.name) return false
  if (p.text !== undefined && !p.children.length) return leafSame(p, n)
  if (p.name === 'ArgList') return argsSame(parts(p), parts(n))
  if (p.name === 'Body') return bodySame(parts(p), parts(n))
  const pp = parts(p)
  const np = parts(n)
  if (CLAUSED.has(p.name) ? pp.length > np.length : pp.length !== np.length) return false
  return pp.every((c, i) => same(c, np[i]))
}

function leafSame(p, n) {
  if (p.name === 'Number') return Number(p.text.replace(/_/g, '')) === Number(n.text.replace(/_/g, ''))
  if (p.name === 'String') return stringValue(p.text) === stringValue(n.text)
  return p.text === n.text
}

/** A string literal's text inside its quotes (and prefix). */
const stringValue = (s) => s.replace(/^[rRbBuU]*('''|"""|'|")/, '').replace(/('''|"""|'|")$/, '')

/**
 * Arguments: `f(...)` takes any; otherwise the pattern's positional ones in
 * order, and its keyword ones among the call's.
 */
function argsSame(p, n) {
  if (p.length === 1 && isEllipsis(p[0])) return true
  const split = (list) => {
    const positional = []
    const keyword = new Map()
    for (let i = 0; i < list.length; i++) {
      if (list[i + 1]?.name === 'AssignOp') {
        keyword.set(list[i].text, list[i + 2])
        i += 2
      } else positional.push(list[i])
    }
    return { positional, keyword }
  }
  const pa = split(p)
  const na = split(n)
  if (pa.positional.length !== na.positional.length) return false
  if (!pa.positional.every((c, i) => same(c, na.positional[i]))) return false
  for (const [name, value] of pa.keyword) {
    if (!na.keyword.has(name) || !same(value, na.keyword.get(name))) return false
  }
  return true
}

/** A body: the pattern's statements appear in the program's, in order (others may come between). */
function bodySame(p, n) {
  let i = 0
  for (const statement of n) {
    if (i < p.length && same(p[i], statement)) i++
  }
  return i === p.length
}
