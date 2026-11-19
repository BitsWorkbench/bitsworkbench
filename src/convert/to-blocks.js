/**
 * Python back to blocks. The whole program is converted at once:
 *
 * - the header the blocks make (banner, imports, setup, `x = None`) is left
 *   out, since the blocks make it again; any line of it they would not make
 *   again stays, as a Python block;
 * - a last `while True:` at the top level is the "forever" block, and the
 *   statements before it go in "on start";
 * - a top-level `def` is a function block, above the rest as Blockly writes
 *   it, and its calls are call blocks (see functionsOf);
 * - each statement becomes the block whose pattern it matches (see
 *   patterns.js), the longest and then the most specific pattern first;
 * - Python with no block stays as it is, in a grey Python block: a whole
 *   statement, or a piece of one in a block's slot;
 * - a comment goes on the block of the statement it ends the line of, or
 *   failing that the next statement, or failing that the one before.
 *
 * Code that does not parse is not converted: the result names its line.
 */
import * as Blockly from 'blockly/core'
import { tree, statementsOf, lineAt, unwrap } from './tree.js'
import { patternsFor } from './patterns.js'
import { pythonGenerator } from 'blockly/python'
import { generatePython, DEVICE_IMPORT, BANNER } from '../blocks/generate.js'
import { BRAND } from '../brand.js'
import { endOfLineData } from '../blocks/comments.js'

const cache = new Map()
function patterns(targetId) {
  if (!cache.has(targetId)) cache.set(targetId, patternsFor(targetId))
  return cache.get(targetId)
}

/**
 * The banner the blocks write, under the product's name today or a past one
 * (a file saved then still starts with it): "Made with LabBlocks 💚 — ...".
 */
const PAST_BANNERS = BRAND.pastNames.map((name) => new RegExp(`^Made with ${name} 💚 `))

/** Comments the blocks write themselves, at the top of every program. */
const HEADER_COMMENT = (text) =>
  text === BANNER.replace(/^# /, '') ||
  PAST_BANNERS.some((re) => re.test(text)) ||
  /^Device: /.test(text) ||
  text === 'Add some blocks and press Run!'

/**
 * { ok: true, state, targetId }: the blocks, as a Blockly workspace state, and
 * the board they are for. { ok: false, line }: the code does not parse there.
 * `imports`: import lines the code runs under but does not hold, read only
 * for what names mean (`from time import sleep`).
 */
export function pythonToBlocks(source, targetId, { imports = '' } = {}) {
  const { root, comments } = tree(source)
  if (root.error) return { ok: false, line: root.error.line }
  const board = boardOf(source) || targetId
  const ctx = new Context(source, patterns(board))
  ctx.assigned = assignedNames(root)
  ctx.lists = listNames(root)
  // `imports`: import lines the code runs with but does not hold (a CodeTrek
  // chunk, whose imports go at the top of the student's program).
  const outside = imports ? tree(imports).root : null
  ctx.imported = new Map([...(outside && !outside.error ? importedNames(statementsOf(outside), imports) : []), ...importedNames(statementsOf(root), source)])
  // (The outside imports count too: the same name imported twice is not one meaning.)
  const extra = outside && !outside.error ? [{ ...outside, src: imports }] : []
  for (const [name, full] of [...ctx.imported]) if (!aliasHolds(root, source, name, full, extra)) ctx.imported.delete(name)

  let top = statementsOf(root)
  // The header the blocks make: pulled out now, put back below if the
  // blocks do not make it again.
  const header = []
  let seenCode = false
  top = top.filter((s) => {
    const text = ctx.text(s)
    const isHeader =
      s.name === 'ImportStatement' ||
      (!seenCode && (text === 'motors.enable(True)' || /^[A-Za-z_]\w* = None$/.test(text)))
    if (isHeader) header.push(s)
    else seenCode = true
    return !isHeader
  })

  // Functions the blocks can hold come out of the program, as Blockly puts
  // every function before the rest; any other `def` stays where it is.
  ctx.functions = functionsOf(top, ctx.assigned)
  const defs = top.filter((s) => ctx.functions.has(functionName(s)))
  top = top.filter((s) => !defs.includes(s))

  let forever = null
  const last = top[top.length - 1]
  if (last && isForever(last)) {
    forever = last
    top = top.slice(0, -1)
  }

  const first = [...defs, ...top][0]
  const ours = comments.filter((c) => !(c.ownLine && HEADER_COMMENT(c.text) && (!first || c.from < first.from)))
  // Comments with no code after them are notes on the workspace, one for
  // each run of lines.
  const end = codeEnd(statementsOf(root))
  const loose = ours.filter((c) => c.ownLine && c.from >= end)
  ctx.loose = runs(loose)
  ctx.anchor(ours.filter((c) => !loose.includes(c)), [
    ...defs,
    ...top,
    ...(forever ? [forever] : []),
  ])

  const defBlocks = defs.map((s) => ctx.defBlock(s))
  const start = ctx.statements(top)
  const foreverBlock = forever ? ctx.foreverBlock(forever) : null

  // The header lines the blocks would not write again stay, in order, first.
  // A `from time import sleep` the blocks have no more need of goes: they
  // write `import time` and `time.sleep(...)` themselves (see importedNames).
  const made = new Set(madeLines(ctx.state(defBlocks, start, foreverBlock), board))
  const greyCode = ctx.greyCode([...defBlocks, ...start, foreverBlock])
  // `from colors import *` goes too where the blocks import CodeX or CodeAIR, which bring the colours.
  const coloursMade = made.has('from codex import *') || made.has('from codeair import *')
  const kept = header.filter((s) => {
    const line = ctx.text(s).replace(/\s+/g, ' ')
    return !made.has(line) && !absorbed(ctx.text(s), made, greyCode) && !(coloursMade && line === 'from colors import *')
  })
  start.unshift(...kept.map((s) => ctx.grey(s)))
  return {
    ok: true,
    state: ctx.state(defBlocks, start, foreverBlock),
    targetId: board,
    pythonLines: ctx.greyLines([...defBlocks, ...start, foreverBlock]),
  }
}

/**
 * Names a program imports from a module by name: `from time import sleep` (or
 * `sleep as wait`) makes `sleep` mean `time.sleep`, so `sleep(1)` is the block
 * that writes `time.sleep(1)`. Only imports at the top level, and only names
 * the program never assigns or defines itself. Map: local name -> 'module.name'.
 */
function importedNames(stmts, source) {
  const out = new Map()
  for (const s of stmts) {
    if (s.name !== 'ImportStatement') continue
    const m = /^from\s+([A-Za-z_][\w.]*)\s+import\s+\(?([^()*]+?)\)?\s*$/s.exec(source.slice(s.from, s.to).replace(/#[^\n]*/g, ''))
    if (!m) continue
    for (const part of m[2].split(',')) {
      const n = /^\s*([A-Za-z_]\w*)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(part)
      if (n) out.set(n[2] || n[1], `${m[1]}.${n[1]}`)
    }
  }
  return out
}

/**
 * Whether `sleep` (imported as `time.sleep`) can be read as `time.sleep`
 * everywhere: apart from import lines, the program only ever calls `sleep`
 * (no assignment, parameter, def, class, loop variable, `as`, or use as a
 * value, in any scope), no other import binds it, and the program never
 * binds `time` itself (a variable named `time` would hide the `import time`
 * the blocks write). Whatever is not plainly one of these keeps its Python.
 */
function aliasHolds(root, source, name, full, extra = []) {
  const module = full.split('.')[0]
  let ok = true
  let bindings = 0
  const walk = (node, parent, src) => {
    if (!ok) return
    if (node.name === 'ImportStatement') {
      const text = src.slice(node.from, node.to).replace(/#[^\n]*/g, '').replace(/\s+/g, ' ').trim()
      const names = (node.children || []).filter((c) => c.name === 'VariableName').map((c) => c.text)
      if (names.includes(name)) bindings++
      // `import time` or `from time import ...` leave the module's name as it is; anything else naming it does not.
      if (names.includes(module) && !new RegExp(`^(import ${module}|from ${module}(\\.[\\w.]+)? import .*)$`).test(text)) ok = false
      if (/^import /.test(text) && names.includes(name)) ok = false
      return
    }
    // `time.sleep = ...` or `del time.sleep`: then `sleep` and `time.sleep` part ways.
    if ((node.name === 'AssignStatement' || node.name === 'UpdateStatement' || node.name === 'DeleteStatement') && targetsModule(node, module)) {
      ok = false
      return
    }
    if (node.name === 'VariableName') {
      const callee = parent?.name === 'CallExpression' && parent.children[0] === node
      const object = parent?.name === 'MemberExpression' && parent.children[0] === node
      if (node.text === name && !callee) ok = false
      if (node.text === module && !object) ok = false
      return
    }
    for (const c of node.children || []) walk(c, node, src)
  }
  walk(root, null, source)
  for (const e of extra) walk(e, null, e.src)
  return ok && bindings <= 1
}

/** Whether a statement assigns to, or deletes, something of `module` (`time.sleep = print`). */
function targetsModule(s, module) {
  const op = s.children.findIndex((c) => c.name === 'AssignOp' || c.name === 'UpdateOp')
  const targets = s.name === 'DeleteStatement' ? s.children : s.children.slice(0, op < 0 ? 0 : op)
  const holds = (n) => (n.name === 'MemberExpression' && n.children[0]?.name === 'VariableName' && n.children[0].text === module) || (n.children || []).some(holds)
  return targets.some(holds)
}

/**
 * A `from M import a, b` line the blocks have taken over: they import M
 * themselves (`import M` is among the lines they make), and no Python left
 * grey uses a or b, so nothing needs the line any more.
 */
function absorbed(line, made, greyCode) {
  const m = /^from\s+([A-Za-z_][\w.]*)\s+import\s+\(?([^()*]+?)\)?$/s.exec(line.replace(/\s+/g, ' ').trim())
  if (!m || !made.has(`import ${m[1]}`)) return false
  const names = m[2].split(',').map((p) => p.trim().split(/\s+as\s+/).pop())
  return names.every((n) => /^[A-Za-z_]\w*$/.test(n) && !new RegExp(`\\b${n}\\b`).test(greyCode))
}

/** Where the last statement's code ends (a body's last statement, in turn). */
function codeEnd(stmts) {
  const s = stmts.at(-1)
  if (!s) return 0
  const body = s.children.filter((c) => c.name === 'Body').pop()
  return body ? Math.max(body.from, codeEnd(statementsOf(body))) : s.to
}

/** Comments on lines one after another, each run as one text. */
function runs(comments) {
  const out = []
  let line = -1
  for (const c of comments) {
    if (c.line === line + 1 && out.length) out[out.length - 1] += `\n${c.text}`
    else out.push(c.text)
    line = c.line
  }
  return out
}

/** A `def`'s name, or null for any other statement. */
function functionName(s) {
  return s.name === 'FunctionDefinition' && s.children[1]?.name === 'VariableName' ? s.children[1].text : null
}

/**
 * The top-level functions the function blocks can hold, by their Python
 * name: { name, params, returns }. One can when it is a plain `def` (no
 * decorator, default, `*args` or type), and when Blockly, writing the block's
 * Python, gives it and its parameters the same names again: a block's name
 * is the Python one with spaces for underscores ("blink twice"), and Blockly
 * renames a function that would clash with a variable, another function or
 * a word Python keeps.
 */
function functionsOf(top, variables) {
  const defs = top.filter((s) => functionName(s))
  const count = {}
  for (const s of defs) count[functionName(s)] = (count[functionName(s)] || 0) + 1
  const names = new Blockly.Names(pythonGenerator.RESERVED_WORDS_)
  for (const v of [...variables].sort()) names.getName(v, Blockly.Names.NameType.DEVELOPER_VARIABLE)
  const out = new Map()
  for (const s of defs) {
    const py = functionName(s)
    const [, , list, body, more] = s.children
    if (count[py] > 1 || list?.name !== 'ParamList' || body?.name !== 'Body' || more) continue
    const inner = list.children.filter((c) => c.name !== '(' && c.name !== ')' && c.name !== ',')
    if (inner.some((c) => c.name !== 'VariableName')) continue
    const params = inner.map((c) => c.text)
    if (new Set(params).size !== params.length) continue
    if (params.some((p) => names.getName(p, Blockly.Names.NameType.DEVELOPER_VARIABLE) !== p)) continue
    const name = py.replace(/(?<=[A-Za-z0-9])_(?=[A-Za-z0-9])/g, ' ')
    if (names.getName(name, Blockly.Names.NameType.PROCEDURE) !== py) continue
    const end = statementsOf(body).at(-1)
    const returns = end?.name === 'ReturnStatement' && end.children.length === 2
    out.set(py, { name, params, returns })
  }
  return out
}

/** The board a program's own import names, if any. */
function boardOf(source) {
  for (const [id, line] of Object.entries(DEVICE_IMPORT)) {
    if (new RegExp(`^${line.replace(/[*]/g, '\\*')}\\s*$`, 'm').test(source)) return id
  }
  return null
}

/** Names given a value anywhere: `x = ...`, `x += ...`, `for x in ...`. */
function assignedNames(node, names = new Set()) {
  const first = node.children?.[0]
  if ((node.name === 'AssignStatement' || node.name === 'UpdateStatement') && first?.name === 'VariableName') {
    names.add(first.text)
  }
  if (node.name === 'ForStatement' && node.children[1]?.name === 'VariableName') names.add(node.children[1].text)
  // A function's parameters are variables too, as Blockly has them.
  if (node.name === 'ParamList') for (const c of node.children) if (c.name === 'VariableName') names.add(c.text)
  for (const c of node.children || []) assignedNames(c, names)
  return names
}

/** Variables the program sets to a list (`x = [...]`), whose `len(x)` is a list's length. */
function listNames(node, names = new Set()) {
  const [first, , value] = node.children || []
  if (node.name === 'AssignStatement' && first?.name === 'VariableName' && unwrap(value || {}).name === 'ArrayExpression') {
    names.add(first.text)
  }
  for (const c of node.children || []) listNames(c, names)
  return names
}

/** `while True:` with no `break` of its own. */
function isForever(s) {
  if (s.name !== 'WhileStatement') return false
  const cond = s.children.find((c) => c.name !== 'while' && c.name !== 'Body')
  if (!cond || cond.name !== 'Boolean' || cond.text !== 'True') return false
  const body = s.children.find((c) => c.name === 'Body')
  return !hasOwnBreak(body)
}

function hasOwnBreak(node) {
  for (const c of node.children || []) {
    if (c.name === 'BreakStatement') return true
    if (c.name === 'WhileStatement' || c.name === 'ForStatement' || c.name === 'FunctionDefinition') continue
    if (hasOwnBreak(c)) return true
  }
  return false
}

/** The lines of Python a workspace state makes, spaces collapsed. */
function madeLines(state, board) {
  const ws = new Blockly.Workspace()
  try {
    Blockly.serialization.workspaces.load(state, ws)
    return generatePython(ws, board)
      .split('\n')
      .map((l) => l.trim().replace(/\s+/g, ' '))
  } finally {
    ws.dispose()
  }
}

class Context {
  constructor(source, pats) {
    this.source = source
    this.pats = pats
    this.variables = new Map()
    this.notes = new Map() // statement node -> [comment]
    this.assigned = new Set() // names the program gives a value: its variables
    this.lists = new Set() // of those, the ones set to a list
    this.functions = new Map() // Python name -> { name, params, returns }: functionsOf
    this.fn = null // the function whose body is being made into blocks
    this.loose = [] // comments with no code after them: workspace notes
    this.greyAt = new WeakMap() // a grey Python block -> the code it holds
  }

  text(node) {
    return this.source.slice(node.from, node.to).trim()
  }

  // ------------------------------------------------------------ comments

  /** Give each comment the statement it belongs to. */
  anchor(comments, top) {
    const all = []
    const walk = (stmts) => {
      for (const s of stmts) {
        const body = s.children.find((c) => c.name === 'Body')
        all.push({ s, first: lineAt(this.source, s.from), last: lineAt(this.source, body ? body.from : s.to) })
        for (const c of s.children) if (c.name === 'Body') walk(statementsOf(c))
      }
    }
    walk(top)
    for (const c of comments) {
      let home = null
      if (!c.ownLine) home = all.filter((a) => a.first <= c.line && c.line <= a.last).pop()
      home ||= all.find((a) => a.s.from > c.from) || all.filter((a) => a.s.from < c.from).pop()
      if (!home) continue
      if (!this.notes.has(home.s)) this.notes.set(home.s, [])
      this.notes.get(home.s).push(c)
    }
  }

  /** Whether a statement's line ends with this comment. */
  endComment(s, text) {
    return (this.notes.get(s) || []).some((c) => !c.ownLine && c.text === text)
  }

  /**
   * Put the comments of these statements on their block (less a pattern's
   * own end-of-line comment). Comments above come first; one that ends the
   * block's first line is the comment's last line, and the block keeps it to
   * write back at the end of that line.
   */
  note(block, stmts, own = null) {
    const above = []
    const ends = []
    for (const s of stmts) {
      for (const c of this.notes.get(s) || []) {
        if (own !== null && !c.ownLine && c.text === own) continue
        ;(c.ownLine ? above : ends).push(c)
      }
    }
    if (!above.length && !ends.length) return
    const firstLine = lineAt(this.source, stmts[0].from)
    const end = ends.length === 1 && ends[0].line === firstLine ? ends[0] : null
    const texts = end ? [...above, end] : [...above, ...ends].sort((a, b) => a.from - b.from)
    block.icons = { comment: { text: texts.map((c) => c.text).join('\n'), pinned: false } }
    if (end) block.data = endOfLineData(end.text)
  }

  /** The "to do" block, if this `pass` ends with `# TODO: what to do`; any other comments go on it. */
  todoAt(s) {
    const own = (this.notes.get(s) || []).find((c) => !c.ownLine && /^TODO:/.test(c.text))
    if (!own) return null
    const block = { type: 'ocb_todo', fields: { TEXT: own.text.replace(/^TODO:\s*/, '') } }
    this.note(block, [s], own.text)
    return block
  }

  // ---------------------------------------------------------- statements

  /** A list of statements as a list of blocks, not yet linked. */
  statements(stmts) {
    const blocks = []
    let i = 0
    while (i < stmts.length) {
      let hit = this.statementAt(stmts, i)
      // A block nothing can follow (`break`, `continue`) with statements after it, as in a
      // CodeTrek chunk cut from inside a loop, stays Python: a block cannot hold them.
      if (hit?.block && ENDS_STACK.has(hit.block.type) && i + hit.count < stmts.length) hit = null
      if (hit) {
        if (hit.block) blocks.push(hit.block)
        i += hit.count
      } else {
        blocks.push(this.grey(stmts[i]))
        i++
      }
    }
    return blocks
  }

  /** The blocks of a list of statements, linked; null for none. */
  chain(stmts) {
    return link(this.statements(stmts))
  }

  statementAt(stmts, i) {
    const s = stmts[i]
    // `pass  # TODO: ...` is a step left for the student: the "to do" block.
    const todo = s.name === 'PassStatement' && this.todoAt(s)
    if (todo) return { block: todo, count: 1 }
    // `pass` holds a place only Python needs; an empty slot is the block's.
    if (s.name === 'PassStatement' && !this.notes.has(s)) return { block: null, count: 1 }
    const byHand = HAND[s.name]?.call(this, s)
    if (byHand) {
      if (!byHand.icons) this.note(byHand, [s])
      return { block: byHand, count: 1 }
    }
    for (const p of this.pats.statements) {
      const n = p.stmts.length
      if (i + n > stmts.length) continue
      // A block that writes its own comment (a note's name) is known by it.
      if (p.comment !== null && !this.endComment(stmts[i + n - 1], p.comment)) continue
      const binds = newBinds()
      if (!p.stmts.every((ps, k) => match(ps, stmts[i + k], binds, p, this))) continue
      const block = this.build(p, binds)
      if (!block) continue
      this.note(block, stmts.slice(i, i + n), p.comment)
      return { block, count: n }
    }
    return null
  }

  foreverBlock(s) {
    const body = s.children.find((c) => c.name === 'Body')
    const block = { type: 'ocb_forever' }
    const chain = this.chain(statementsOf(body))
    if (chain) block.inputs = { DO: { block: chain } }
    this.note(block, [s])
    return block
  }

  /**
   * A function (one functionsOf found): "to do something" with its
   * parameters, its body and, for one that ends `return x`, x. The `global`
   * lines go, since Blockly writes them again for every variable.
   */
  defBlock(s) {
    const py = functionName(s)
    const info = this.functions.get(py)
    let body = statementsOf(s.children[3])
    body = body.filter((st) => !(this.isGlobal(st) && !this.notes.has(st)))
    const end = info.returns ? body.pop() : null
    const block = { type: info.returns ? 'procedures_defreturn' : 'procedures_defnoreturn', fields: { NAME: info.name } }
    if (info.params.length) block.extraState = { params: info.params.map((p) => ({ name: p, id: this.variable(p) })) }
    this.fn = info
    const inputs = {}
    const chain = this.chain(body)
    if (chain) inputs.STACK = { block: chain }
    if (end) inputs.RETURN = { block: this.value(end.children[1]) }
    this.fn = null
    if (Object.keys(inputs).length) block.inputs = inputs
    this.note(block, end ? [s, end] : [s])
    return block
  }

  /** `global x, y` naming only the program's variables. */
  isGlobal(s) {
    if (s.name !== 'ScopeStatement' || s.children[0]?.name !== 'global') return false
    return s.children.slice(1).every((c) => c.name === ',' || (c.name === 'VariableName' && this.assigned.has(c.text)))
  }

  /**
   * A call of one of the program's functions, as a statement ("do
   * something") or a value ("twice"): its block, or null.
   */
  call(node, value) {
    node = unwrap(node)
    const callee = node.name === 'CallExpression' ? node.children[0] : null
    const info = callee?.name === 'VariableName' && this.functions.get(callee.text)
    if (!info || info.returns !== value) return null
    const args = callArgs(node, callee.text)
    if (!args || args.length !== info.params.length) return null
    const block = { type: value ? 'procedures_callreturn' : 'procedures_callnoreturn', extraState: { name: info.name, params: info.params } }
    if (args.length) block.inputs = Object.fromEntries(args.map((a, k) => [`ARG${k}`, { block: this.value(a) }]))
    return block
  }

  /**
   * The lines (from 1) of the code these blocks hold as grey Python blocks,
   * in order: the lines with no block of their own.
   */
  greyLines(blocks) {
    const lines = new Set()
    const walk = (b) => {
      if (!b) return
      const node = this.greyAt.get(b)
      if (node) {
        const end = node.from + this.source.slice(node.from, node.to).trimEnd().length
        for (let l = lineAt(this.source, node.from); l <= lineAt(this.source, end); l++) lines.add(l)
      }
      for (const input of Object.values(b.inputs || {})) {
        walk(input.block)
        walk(input.shadow)
      }
      walk(b.next?.block)
    }
    blocks.forEach(walk)
    return [...lines].sort((a, b) => a - b)
  }

  /** All the Python these blocks keep as grey Python blocks, as one text. */
  greyCode(blocks) {
    const parts = []
    const walk = (b) => {
      if (!b) return
      const node = this.greyAt.get(b)
      if (node) parts.push(this.source.slice(node.from, node.to))
      for (const input of Object.values(b.inputs || {})) {
        walk(input.block)
        walk(input.shadow)
      }
      walk(b.next?.block)
    }
    blocks.forEach(walk)
    return parts.join('\n')
  }

  /** A statement with no block: a grey Python block holding its text. */
  grey(s) {
    const lineStart = this.source.lastIndexOf('\n', s.from - 1) + 1
    const indent = s.from - lineStart
    const text = this.source
      .slice(s.from, s.to)
      .replace(/\s+$/, '')
      .split('\n')
      .map((l, k) => (k === 0 ? l : l.replace(new RegExp(`^ {0,${indent}}`), '')))
      .join('\n')
    const block = { type: 'ocb_python', fields: { CODE: text } }
    this.greyAt.set(block, s)
    this.note(block, [s])
    return block
  }

  // -------------------------------------------------------------- values

  value(u, check) {
    u = unwrap(u)
    let byHand = null
    for (const p of this.pats.values) {
      // A pattern with more fixed code than a hand-written form (a board's
      // `ls.check()[0]`) is the more specific; after those, the hand-written
      // forms, before the operators (`'a' + str(b)` is a join, not a sum).
      if (p.size < HAND_SIZE && byHand === null) {
        byHand = HAND_VALUE[u.name]?.call(this, u) || false
        if (byHand) return byHand
      }
      const binds = newBinds()
      if (!match(p.expr, u, binds, p, this)) continue
      if (!fits(p.output.check, check)) continue
      const block = this.build(p, binds)
      if (block) return block
    }
    if (byHand === null) {
      byHand = HAND_VALUE[u.name]?.call(this, u)
      if (byHand) return byHand
    }
    // A name the program gives a value somewhere is a variable.
    if (u.name === 'VariableName' && this.assigned.has(u.text)) {
      return { type: 'variables_get', fields: { VAR: { id: this.variable(u.text) } } }
    }
    const grey = { type: 'ocb_python_value', fields: { CODE: this.text(u) } }
    this.greyAt.set(grey, u)
    return grey
  }

  /** The block a pattern matched, with its fields and inputs filled in. */
  build(p, binds) {
    const block = { type: p.type }
    if (p.extraState) block.extraState = p.extraState
    const fields = { ...p.combo }
    for (const [name, f] of Object.entries(p.fields)) {
      const got = binds.fields[name]
      if (got === undefined) return null
      fields[name] = f.kind === 'variable' ? { id: this.variable(got) } : got
    }
    if (Object.keys(fields).length) block.fields = fields
    const inputs = {}
    for (const [name, info] of Object.entries(p.inputs)) {
      if (info.kind === 'value') {
        const u = binds.values[name]
        if (!u) continue
        inputs[name] = withShadow(this.value(u, info.check), p.shadows[name])
      } else {
        const chain = this.chain(binds.stmts[name] || [])
        if (chain) inputs[name] = { block: chain }
      }
    }
    if (Object.keys(inputs).length) block.inputs = inputs
    return block
  }

  /** A join of these parts: text stays text, `str(x)` is x. */
  join(parts) {
    const inputs = {}
    parts.forEach((p, k) => {
      const inner = callArgs(p, 'str')
      inputs[`ADD${k}`] = { block: this.value(inner?.length === 1 ? inner[0] : p) }
    })
    return { type: 'text_join', extraState: { itemCount: parts.length }, inputs }
  }

  /** The output check of a block made here (null: fits anywhere). */
  outputOf(block) {
    if (!this.outputs) {
      this.outputs = { lists_create_with: ['Array'], text_join: ['String'] }
      for (const p of this.pats.values) if (!(p.type in this.outputs)) this.outputs[p.type] = p.output.check
    }
    return this.outputs[block.type] ?? null
  }

  /**
   * Where a list index points, as the list blocks say it: { where, at }, or
   * null for one they do not (the blocks count from 1, Python from 0).
   */
  indexOf(node) {
    const n = wholeNumber(node)
    const num = (v) => ({ block: { type: 'math_number', fields: { NUM: v } } })
    if (n === 0) return { where: 'FIRST' }
    if (n === -1) return { where: 'LAST' }
    if (n !== null) return n > 0 ? { where: 'FROM_START', at: num(n + 1) } : { where: 'FROM_END', at: num(-n) }
    // What the blocks write for an index worked out: int(E - 1), and -int(E).
    const inner = callArgs(node, 'int')
    if (inner?.length === 1) {
      const e = unwrap(inner[0])
      if (e.name === 'BinaryExpression' && e.children[1]?.text === '-' && wholeNumber(e.children[2]) === 1) {
        return { where: 'FROM_START', at: { block: this.value(e.children[0], ['Number']) } }
      }
    }
    const u = unwrap(node)
    if (u.name === 'UnaryExpression' && u.children[0]?.text === '-' && u.children.length === 2) {
      const args = callArgs(u.children[1], 'int')
      if (args?.length === 1) return { where: 'FROM_END', at: { block: this.value(args[0], ['Number']) } }
    }
    return null
  }

  /** A list block: get, take or remove (MODE), set or insert, at an index. */
  listBlock(type, mode, index, list, to, statement = false) {
    const block = { type, fields: { MODE: mode, WHERE: index.where }, inputs: { [type === 'lists_getIndex' ? 'VALUE' : 'LIST']: { block: this.value(list, ['Array']) } } }
    if (index.at) block.inputs.AT = index.at
    if (to) block.inputs.TO = { block: this.value(to) }
    if (statement) block.extraState = { isStatement: true }
    return block
  }

  variable(name) {
    if (!this.variables.has(name)) this.variables.set(name, `py-var-${name}`)
    return this.variables.get(name)
  }

  /**
   * The workspace state: the functions, "on start" and "forever", top to
   * bottom as in the Python, and the variables. (Blockly writes functions in
   * the order they stand on the canvas.)
   */
  state(defs, start, forever) {
    const blocks = []
    let y = 40
    const place = (block, rows) => {
      blocks.push({ ...block, x: 40, y })
      y += 40 * (rows + 2)
    }
    for (const d of defs) place(copy(d), JSON.stringify(d).split('"type"').length)
    const first = link(start.map(copy))
    if (first) place({ type: 'ocb_on_start', inputs: { DO: { block: first } } }, start.length)
    if (forever) place(copy(forever), 1)
    const state = { blocks: { languageVersion: 0, blocks } }
    if (this.loose.length) {
      state.workspaceComments = this.loose.map((text) => {
        const note = { text, x: 40, y }
        y += 40 * (text.split('\n').length + 2)
        return note
      })
    }
    if (this.variables.size) state.variables = [...this.variables].map(([name, id]) => ({ name, id }))
    return state
  }
}

/**
 * Blockly's own blocks whose Python is not one fixed shape, by statement
 * kind. Each returns a block, or nothing when the statement is not its block.
 */
const HAND = {
  /** if, any number of elif, else: one "if" block with its + and - parts. */
  IfStatement(s) {
    const parts = s.children
    // In a function, `if c: return` (`return x` in one that returns a value)
    // is "if c return".
    const only = parts.length === 3 && parts[2].name === 'Body' && statementsOf(parts[2])
    const ret = only?.length === 1 && only[0].name === 'ReturnStatement' ? only[0] : null
    if (this.fn && ret && ret.children.length === (this.fn.returns ? 2 : 1)) {
      const block = { type: 'procedures_ifreturn', extraState: `<mutation value="${this.fn.returns ? 1 : 0}"></mutation>` }
      block.inputs = { CONDITION: { block: this.value(parts[1], ['Boolean']) } }
      if (this.fn.returns) block.inputs.VALUE = { block: this.value(ret.children[1]) }
      this.note(block, [s, ret])
      return block
    }
    const block = { type: 'controls_if', inputs: {} }
    let n = 0
    let hasElse = false
    for (let k = 0; k < parts.length; k++) {
      const word = parts[k].name
      if (word === 'if' || word === 'elif') {
        block.inputs[`IF${n}`] = { block: this.value(parts[k + 1], ['Boolean']) }
        const chain = this.chain(statementsOf(parts[k + 2]))
        if (chain) block.inputs[`DO${n}`] = { block: chain }
        n++
        k += 2
      } else if (word === 'else') {
        hasElse = true
        const chain = this.chain(statementsOf(parts[k + 1]))
        if (chain) block.inputs.ELSE = { block: chain }
        k += 1
      }
    }
    if (n > 1 || hasElse) {
      block.extraState = {}
      if (n > 1) block.extraState.elseIfCount = n - 1
      if (hasElse) block.extraState.hasElse = true
    }
    return block
  },

  /**
   * `for count in range(n):` whose body does not use its counter is "repeat
   * n times"; `for i in range(...)` over whole numbers is "count with i".
   * (Any other `for` is "for each item in list", by its pattern.)
   */
  ForStatement(s) {
    const [, target, , iter, body] = s.children
    if (target?.name !== 'VariableName' || iter?.name !== 'CallExpression' || body?.name !== 'Body') return null
    const args = callArgs(iter, 'range')
    if (!args) return null
    let block
    if (args.length === 1 && !uses(body, target.text)) {
      // Blockly writes `range(int(n))` when n is not a plain number.
      const times = callArgs(args[0], 'int')?.length === 1 ? callArgs(args[0], 'int')[0] : args[0]
      block = {
        type: 'controls_repeat_ext',
        inputs: { TIMES: withShadow(this.value(times, ['Number']), this.pats.shadows.controls_repeat_ext?.TIMES) },
      }
    } else {
      const span = countSpan(args.map(wholeNumber))
      if (!span) return null
      const shadows = this.pats.shadows.controls_for || {}
      const num = (n, name) => withShadow({ type: 'math_number', fields: { NUM: n } }, shadows[name])
      block = {
        type: 'controls_for',
        fields: { VAR: { id: this.variable(target.text) } },
        inputs: { FROM: num(span.from, 'FROM'), TO: num(span.to, 'TO'), BY: num(span.by, 'BY') },
      }
    }
    const chain = this.chain(statementsOf(body))
    if (chain) block.inputs.DO = { block: chain }
    return block
  },

  /** `x += n` and `x -= n`: "change x by". */
  UpdateStatement(s) {
    const [target, op, delta] = s.children
    if (target?.name !== 'VariableName' || !delta) return null
    let by
    if (op.text === '+=') by = this.value(delta, ['Number'])
    else if (op.text === '-=' && wholeNumber(delta) !== null) by = { type: 'math_number', fields: { NUM: -wholeNumber(delta) } }
    else if (op.text === '-=' && unwrap(delta).name === 'Number') by = { type: 'math_number', fields: { NUM: -Number(unwrap(delta).text) } }
    else return null
    return {
      type: 'math_change',
      fields: { VAR: { id: this.variable(target.text) } },
      inputs: { DELTA: withShadow(by, this.pats.shadows.math_change?.DELTA) },
    }
  },
}

/** About the most fixed code a hand-written value form has (`len(x)`, `x[0]`). */
const HAND_SIZE = 6

/** Blockly's own value blocks whose Python is not one fixed shape, by node kind. */
const HAND_VALUE = {
  /** `items[i]`: "get item i". */
  MemberExpression(u) {
    const sub = subscript(u)
    const index = sub && this.indexOf(sub.index)
    return index ? this.listBlock('lists_getIndex', 'GET', index, sub.list) : null
  },

  CallExpression(u) {
    const call = this.call(u, true)
    if (call) return call
    const method = methodCall(u)
    // `items.pop(i)` and `items.pop()`: "get and remove item i" (the last).
    if (method?.name === 'pop' && method.args.length <= 1) {
      const index = method.args.length ? this.indexOf(method.args[0]) : { where: 'LAST' }
      return index ? this.listBlock('lists_getIndex', 'GET_REMOVE', index, method.object) : null
    }
    // `random.choice(items)`: "get a random item".
    if (method?.name === 'choice' && method.args.length === 1 && method.object.name === 'VariableName' && method.object.text === 'random') {
      return this.listBlock('lists_getIndex', 'GET', { where: 'RANDOM' }, method.args[0])
    }
    // `len(x)`: the length of a list, or of a text.
    const len = callArgs(u, 'len')
    if (len?.length === 1) {
      const of = this.value(len[0])
      const arg = unwrap(len[0])
      const list = this.outputOf(of)?.includes('Array') || (arg.name === 'VariableName' && this.lists.has(arg.text))
      return { type: list ? 'lists_length' : 'text_length', inputs: { VALUE: { block: of } } }
    }
    // `str(x)` alone: a join of one.
    const str = callArgs(u, 'str')
    if (str?.length === 1) return this.join([u])
    return null
  },

  /** `'a' + str(b) + 'c'`: "create text with" (a join), when any part is text. */
  BinaryExpression(u) {
    const parts = plusParts(u)
    const texty = (p) => (unwrap(p).name === 'String' && decode(unwrap(p).text) !== null) || callArgs(p, 'str')?.length === 1
    if (parts.length < 2 || !parts.some(texty)) return null
    return this.join(parts)
  },

  /** `[a, b, c]`: "create list with". */
  ArrayExpression(u) {
    const items = u.children.filter((c) => !['[', ']', ','].includes(c.name))
    if (items.some((c) => c.name === 'ArrayComprehensionExpression' || c.text === '*' || c.name === 'for')) return null
    const block = { type: 'lists_create_with', extraState: { itemCount: items.length } }
    if (items.length) block.inputs = Object.fromEntries(items.map((c, k) => [`ADD${k}`, { block: this.value(c) }]))
    return block
  },
}

/** Blockly's own statement blocks that are calls or assignments, by hand. */
Object.assign(HAND, {
  ExpressionStatement(s) {
    const call = this.call(s.children[0], false)
    if (call) return call
    const method = methodCall(s.children[0])
    if (!method) return null
    // `items.pop(i)` on its own: "remove item i".
    if (method.name === 'pop' && method.args.length <= 1) {
      const index = method.args.length ? this.indexOf(method.args[0]) : { where: 'LAST' }
      return index ? this.listBlock('lists_getIndex', 'REMOVE', index, method.object, null, true) : null
    }
    // `items.insert(i, x)` and `items.append(x)`: "insert at".
    if (method.name === 'insert' && method.args.length === 2) {
      const index = this.indexOf(method.args[0])
      return index ? this.listBlock('lists_setIndex', 'INSERT', index, method.object, method.args[1]) : null
    }
    if (method.name === 'append' && method.args.length === 1) {
      return this.listBlock('lists_setIndex', 'INSERT', { where: 'LAST' }, method.object, method.args[0])
    }
    return null
  },

  /** `items[i] = x`: "set item i". */
  AssignStatement(s) {
    const [target, op, to] = s.children
    const sub = target && op?.text === '=' && to && subscript(target)
    const index = sub && this.indexOf(sub.index)
    return index ? this.listBlock('lists_setIndex', 'SET', index, sub.list, to) : null
  },
})

/** `list[index]` with one index: { list, index }, or null. */
function subscript(node) {
  node = unwrap(node)
  if (node.name !== 'MemberExpression') return null
  const [list, open, index, close] = node.children
  if (open?.name !== '[' || close?.name !== ']' || node.children.length !== 4) return null
  return { list, index }
}

/** `object.name(args)`: { object, name, args }, or null. */
function methodCall(node) {
  node = unwrap(node)
  if (node.name !== 'CallExpression') return null
  const [callee, list] = node.children
  if (callee?.name !== 'MemberExpression' || callee.children[1]?.name !== '.' || list?.name !== 'ArgList') return null
  const args = list.children.filter((c) => c.name !== '(' && c.name !== ')' && c.name !== ',')
  if (args.some((a) => a.children?.some((c) => c.name === 'AssignOp'))) return null
  return { object: callee.children[0], name: callee.children[2]?.text, args }
}

/** The parts of `a + b + c`, left to right. */
function plusParts(node) {
  node = unwrap(node)
  if (node.name === 'BinaryExpression' && node.children[1]?.text === '+') return [...plusParts(node.children[0]), node.children[2]]
  return [node]
}

/** A whole number written as one (`3`, `-1`), or null. */
function wholeNumber(node) {
  node = unwrap(node)
  let sign = 1
  if (node.name === 'UnaryExpression' && node.children[0]?.text === '-' && node.children.length === 2) {
    sign = -1
    node = unwrap(node.children[1])
  }
  if (node.name !== 'Number' || !/^\d+$/.test(node.text)) return null
  return sign * Number(node.text)
}

/**
 * The "count with" block's from, to and by for `range(...)` over whole
 * numbers, when the block makes that same `range(...)` again; else null.
 * (The block counts from and to inclusive, either way; range stops short.)
 */
function countSpan(nums) {
  if (nums.some((n) => n === null)) return null
  const [a, b, step] = nums.length === 1 ? [0, nums[0], 1] : nums.length === 2 ? [...nums, 1] : nums
  if (step > 0 && a <= b - 1) return { from: a, to: b - 1, by: step }
  if (step < 0 && a > b + 1) return { from: a, to: b + 1, by: -step }
  return null
}

/** The arguments of a call to the plain function `name`, or null. */
function callArgs(node, name) {
  node = unwrap(node)
  if (node.name !== 'CallExpression') return null
  const [callee, list] = node.children
  if (callee?.name !== 'VariableName' || callee.text !== name || list?.name !== 'ArgList') return null
  const args = list.children.filter((c) => c.name !== '(' && c.name !== ')' && c.name !== ',')
  // Keyword or starred arguments are not this block's.
  return args.some((a) => a.name !== 'Number' && a.children?.some((c) => c.name === 'AssignOp' || c.text === '*')) ? null : args
}

/** Whether a name is used anywhere under a node. */
function uses(node, name) {
  if (node.name === 'VariableName' && node.text === name) return true
  return (node.children || []).some((c) => uses(c, name))
}

const copy = (block) => JSON.parse(JSON.stringify(block))

/** Blocks with no connection below them: nothing can be linked after one. */
const ENDS_STACK = new Set(['controls_flow_statements'])

function link(blocks) {
  for (let k = blocks.length - 2; k >= 0; k--) blocks[k].next = { block: blocks[k + 1] }
  return blocks[0] || null
}

/** A literal in an input with a default of its kind takes the default's place. */
function withShadow(block, toolboxInput) {
  const shadow = toolboxInput?.shadow
  if (shadow && block.type === shadow.type && !block.inputs) return { shadow: block }
  return shadow ? { block, shadow } : { block }
}

/** Whether a block's output may plug into an input. */
function fits(output, input) {
  if (!output || !input) return true
  return output.some((t) => input.includes(t))
}

const newBinds = () => ({ values: {}, stmts: {}, fields: {} })

// --------------------------------------------------------------- matching

/** Does the user's node `u` fit the pattern node `p`? Fills `binds`. */
function match(p, u, binds, pat, ctx) {
  const slot = /^__v_(\w+)__$/.exec(p.name === 'VariableName' ? p.text : '')
  if (slot) {
    const name = slot[1]
    if (name in binds.values) return same(binds.values[name], u)
    binds.values[name] = u
    return true
  }
  const field = fieldAt(p, pat)
  if (field) return matchField(field, p, u, binds)
  // `from time import sleep`: the program's `sleep` is the pattern's `time.sleep`.
  if (p.name === 'MemberExpression' && u.name === 'VariableName' && ctx?.imported?.get(u.text) === dotted(p)) return true
  if (p.name !== u.name) return false
  if (p.name === 'ArgList' && pat.omit) return matchArgs(p, u, binds, pat, ctx)
  if (p.name === 'Body') {
    const ps = statementsOf(p)
    const s = ps.length === 1 && /^__s_(\w+)__$/.exec(ps[0].children[0]?.text || '')
    if (s && ps[0].name === 'ExpressionStatement') {
      binds.stmts[s[1]] = statementsOf(u)
      return true
    }
  }
  if (p.text !== undefined || u.text !== undefined) return sameLeaf(p, u)
  if (p.children.length !== u.children.length) return false
  return p.children.every((pc, k) => match(pc, u.children[k], binds, pat, ctx))
}

/**
 * A call's arguments, for a block whose Python may leave some out
 * (define.js omittable): positional ones in order, keyword ones by name, in
 * any order. A pattern argument the call does not give is fine if the block
 * says it may be left out: a field then takes the value the block gives for
 * that (the library's default), an input keeps its default block. Positional
 * arguments past the pattern's fill its keyword ones, in order, as Python
 * passes them.
 */
function matchArgs(p, u, binds, pat, ctx) {
  const pa = argsOf(p)
  const ua = argsOf(u)
  if (!pa || !ua) return false
  const keywords = [...pa.keyword.keys()]
  const extra = ua.positional.slice(pa.positional.length)
  if (extra.length > keywords.length) return false
  for (const [k, node] of extra.entries()) {
    if (ua.keyword.has(keywords[k])) return false
    ua.keyword.set(keywords[k], node)
  }
  for (const name of ua.keyword.keys()) if (!pa.keyword.has(name)) return false
  const leftOut = (pn) => {
    const slot = /^__v_(\w+)__$/.exec(pn.name === 'VariableName' ? pn.text : '')
    if (slot) return pat.omit[slot[1]] !== undefined
    const field = fieldAt(pn, pat)
    if (!field || pat.omit[field.name] === undefined) return false
    if (field.name in binds.fields) return binds.fields[field.name] === pat.omit[field.name]
    binds.fields[field.name] = pat.omit[field.name]
    return true
  }
  for (const [k, pn] of pa.positional.entries()) {
    if (k < ua.positional.length) {
      if (!match(pn, ua.positional[k], binds, pat, ctx)) return false
    } else if (!leftOut(pn)) return false
  }
  for (const [name, pn] of pa.keyword) {
    const un = ua.keyword.get(name)
    if (un ? !match(pn, un, binds, pat, ctx) : !leftOut(pn)) return false
  }
  return true
}

/** An ArgList's arguments: { positional: [node], keyword: Map name -> node }, or null for `*args`/`**kw`. */
function argsOf(list) {
  const items = list.children.filter((c) => !['(', ')', ','].includes(c.name))
  if (items.some((c) => /^\*\*?$/.test(c.text ?? c.name))) return null
  const positional = []
  const keyword = new Map()
  for (let i = 0; i < items.length; i++) {
    if (items[i + 1]?.name === 'AssignOp') {
      // A keyword given twice is an error in Python: it stays Python, as typed.
      if (keyword.has(items[i].text)) return null
      keyword.set(items[i].text, items[i + 2])
      i += 2
    } else if (keyword.size) return null // a positional argument after a keyword: an error too
    else positional.push(items[i])
  }
  return { positional, keyword }
}

/** A pattern's `module.name` (names only, no placeholder), as text; else null. */
function dotted(p) {
  if (p.name === 'VariableName') return /^__/.test(p.text) ? null : p.text
  if (p.name !== 'MemberExpression' || p.children.length !== 3) return null
  const [obj, dot, prop] = p.children
  const left = dotted(obj)
  return left && dot.text === '.' && prop.name === 'PropertyName' ? `${left}.${prop.text}` : null
}

/** The field whose marker is in this pattern node, if any. */
function fieldAt(p, pat) {
  if (p.text === undefined) return null
  for (const [name, f] of Object.entries(pat.fields)) {
    const text = p.name === 'String' ? decode(p.text) : p.text
    if (text !== null && text.includes(f.marker)) return { name, ...f }
  }
  return null
}

function matchField(field, p, u, binds) {
  let got
  if (field.kind === 'number') {
    u = unwrap(u)
    let sign = 1
    if (u.name === 'UnaryExpression' && u.children[0]?.text === '-' && u.children.length === 2) {
      sign = -1
      u = unwrap(u.children[1])
    }
    if (u.name !== 'Number') return false
    got = sign * Number(u.text.replace(/_/g, ''))
    if (!Number.isFinite(got)) return false
  } else if (field.kind === 'variable') {
    if (u.name !== 'VariableName') return false
    got = u.text
  } else {
    if (u.name !== p.name) return false
    const pt = p.name === 'String' ? decode(p.text) : p.text
    const ut = u.name === 'String' ? decode(u.text) : u.text
    if (ut === null) return false
    const [pre, post] = pt.split(field.marker)
    if (!ut.startsWith(pre) || !ut.endsWith(post) || ut.length < pre.length + post.length) return false
    got = ut.slice(pre.length, ut.length - post.length)
  }
  if (field.name in binds.fields) return binds.fields[field.name] === got
  binds.fields[field.name] = got
  return true
}

/** Two pieces of the user's code that say the same thing. */
function same(a, b) {
  if (a.name !== b.name) return false
  if (a.text !== undefined || b.text !== undefined) return sameLeaf(a, b)
  return a.children.length === b.children.length && a.children.every((c, k) => same(c, b.children[k]))
}

function sameLeaf(a, b) {
  if (a.name === 'String' && b.name === 'String') {
    const x = decode(a.text)
    return x !== null && x === decode(b.text)
  }
  return a.text === b.text
}

/**
 * The value of a plain Python string literal, or null for one this does not
 * read (an f-string, bytes, a triple-quoted string, a `\N{name}` escape).
 */
export function decode(literal) {
  const m = /^([rRuU]?)(['"])(.*)\2$/s.exec(literal)
  if (!m || literal.startsWith(m[2].repeat(3), m[1].length)) return null
  if (m[1].toLowerCase() === 'r') return m[3]
  // `\N{...}` names a character by its Unicode name, which needs a table this does not carry.
  if (/(^|[^\\])(\\\\)*\\N\{/.test(m[3])) return null
  const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', '\n': '' }
  return m[3].replace(/\\([0-7]{1,3}|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gs, (all, e) => {
    if (/^[0-7]/.test(e)) return String.fromCodePoint(parseInt(e, 8))
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16))
    return e in simple ? simple[e] : all
  })
}
