/**
 * Python back to blocks. The whole program is converted at once:
 *
 * - the header the blocks make (banner, imports, setup, `x = None`) is left
 *   out, since the blocks make it again; any line of it they would not make
 *   again stays, as a Python block;
 * - a last `while True:` at the top level is the "forever" block, and the
 *   statements before it go in "on start";
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
import { generatePython, DEVICE_IMPORT, BANNER } from '../blocks/generate.js'

const cache = new Map()
function patterns(targetId) {
  if (!cache.has(targetId)) cache.set(targetId, patternsFor(targetId))
  return cache.get(targetId)
}

/** Comments the blocks write themselves, at the top of every program. */
const HEADER_COMMENT = (text) =>
  text === BANNER.replace(/^# /, '') || /^Device: /.test(text) || text === 'Add some blocks and press Run!'

/**
 * { ok: true, state, targetId }: the blocks, as a Blockly workspace state, and
 * the board they are for. { ok: false, line }: the code does not parse there.
 */
export function pythonToBlocks(source, targetId) {
  const { root, comments } = tree(source)
  if (root.error) return { ok: false, line: root.error.line }
  const board = boardOf(source) || targetId
  const ctx = new Context(source, patterns(board))

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

  let forever = null
  const last = top[top.length - 1]
  if (last && isForever(last)) {
    forever = last
    top = top.slice(0, -1)
  }

  ctx.anchor(comments.filter((c) => !(c.ownLine && HEADER_COMMENT(c.text) && (!top[0] || c.from < top[0].from))), [
    ...top,
    ...(forever ? [forever] : []),
  ])

  const start = ctx.statements(top)
  const foreverBlock = forever ? ctx.foreverBlock(forever) : null

  // The header lines the blocks would not write again stay, in order, first.
  const made = new Set(madeLines(ctx.state(start, foreverBlock), board))
  const kept = header.filter((s) => !made.has(ctx.text(s).replace(/\s+/g, ' ')))
  start.unshift(...kept.map((s) => ctx.grey(s)))
  return { ok: true, state: ctx.state(start, foreverBlock), targetId: board }
}

/** The board a program's own import names, if any. */
function boardOf(source) {
  for (const [id, line] of Object.entries(DEVICE_IMPORT)) {
    if (new RegExp(`^${line.replace(/[*]/g, '\\*')}\\s*$`, 'm').test(source)) return id
  }
  return null
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

  /** Comments of these statements, less a pattern's own end-of-line comment. */
  commentFor(stmts, own = null) {
    const texts = []
    for (const s of stmts) {
      for (const c of this.notes.get(s) || []) {
        if (own !== null && !c.ownLine && c.text === own) continue
        texts.push(c.text)
      }
    }
    return texts.length ? texts.join('\n') : null
  }

  // ---------------------------------------------------------- statements

  /** A list of statements as a list of blocks, not yet linked. */
  statements(stmts) {
    const blocks = []
    let i = 0
    while (i < stmts.length) {
      const hit = this.statementAt(stmts, i)
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
    // `pass` holds a place only Python needs; an empty slot is the block's.
    if (s.name === 'PassStatement' && !this.notes.has(s)) return { block: null, count: 1 }
    const byHand = HAND[s.name]?.call(this, s)
    if (byHand) {
      const comment = this.commentFor([s])
      if (comment) byHand.icons = { comment: { text: comment, pinned: false } }
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
      const comment = this.commentFor(stmts.slice(i, i + n), p.comment)
      if (comment) block.icons = { comment: { text: comment, pinned: false } }
      return { block, count: n }
    }
    return null
  }

  foreverBlock(s) {
    const body = s.children.find((c) => c.name === 'Body')
    const block = { type: 'ocb_forever' }
    const chain = this.chain(statementsOf(body))
    if (chain) block.inputs = { DO: { block: chain } }
    const comment = this.commentFor([s])
    if (comment) block.icons = { comment: { text: comment, pinned: false } }
    return block
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
    const comment = this.commentFor([s])
    if (comment) block.icons = { comment: { text: comment, pinned: false } }
    return block
  }

  // -------------------------------------------------------------- values

  value(u, check) {
    u = unwrap(u)
    for (const p of this.pats.values) {
      const binds = newBinds()
      if (!match(p.expr, u, binds, p, this)) continue
      if (!fits(p.output.check, check)) continue
      const block = this.build(p, binds)
      if (block) return block
    }
    return { type: 'ocb_python_value', fields: { CODE: this.text(u) } }
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

  variable(name) {
    if (!this.variables.has(name)) this.variables.set(name, `py-var-${name}`)
    return this.variables.get(name)
  }

  /** The workspace state: "on start" and "forever", and the variables. */
  state(start, forever) {
    const blocks = []
    const first = link(start.map(copy))
    if (first) blocks.push({ type: 'ocb_on_start', x: 40, y: 40, inputs: { DO: { block: first } } })
    if (forever) blocks.push({ ...copy(forever), x: 40, y: first ? 40 + 40 * (start.length + 2) : 40 })
    const state = { blocks: { languageVersion: 0, blocks } }
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

  /** `for count in range(n):` whose body does not use its counter: "repeat n times". */
  ForStatement(s) {
    const [, target, , iter, body] = s.children
    if (target?.name !== 'VariableName' || iter?.name !== 'CallExpression' || body?.name !== 'Body') return null
    const args = callArgs(iter, 'range')
    if (!args || args.length !== 1 || uses(body, target.text)) return null
    // Blockly writes `range(int(n))` when n is not a plain number.
    const times = callArgs(args[0], 'int')?.length === 1 ? callArgs(args[0], 'int')[0] : args[0]
    const block = {
      type: 'controls_repeat_ext',
      inputs: { TIMES: withShadow(this.value(times, ['Number']), this.pats.shadows.controls_repeat_ext?.TIMES) },
    }
    const chain = this.chain(statementsOf(body))
    if (chain) block.inputs.DO = { block: chain }
    return block
  },
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
  if (p.name !== u.name) return false
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
 * read (an f-string, bytes, a triple-quoted string).
 */
export function decode(literal) {
  const m = /^([rRuU]?)(['"])(.*)\2$/s.exec(literal)
  if (!m || literal.startsWith(m[2].repeat(3), m[1].length)) return null
  if (m[1].toLowerCase() === 'r') return m[3]
  const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', 0: '\0' }
  return m[3].replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gs, (all, e) => {
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16))
    return e in simple ? simple[e] : all
  })
}
