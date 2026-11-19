/**
 * Mission packs, read and checked (the format is docs/mission-packs.md).
 * A pack comes from outside, as a file or from a class, so it is checked
 * whole before anything uses it, and every problem is named with where it is.
 */
import { tree } from '../convert/tree.js'
import { riskyRegex } from './regex.js'
import { BRAND } from '../brand.js'

export const FORMAT = 1
export const BOARDS = ['codebot', 'codex', 'codeair']
export const SECTIONS = ['Blocks', 'Python', 'Concept', 'Caution', 'Peek', 'Remix', 'Run', 'Debug', 'Touch', 'ConsoleData', 'CheckTheTrek']
export const EVENTS = ['edited', 'file-created', 'trek-used', 'stepped', 'switched']

/** A pack that breaks the format: `problems` is every one, `where: what` each. */
export class PackError extends Error {
  constructor(problems) {
    super(problems.join('\n'))
    this.name = 'PackError'
    this.problems = problems
  }
}

/** A pack file's text, as a pack. Objectives get their board and xp filled in. */
export function readPack(text) {
  const raw = parse(text)
  const c = new Checker()
  c.fields(raw, '', {
    format: c.format,
    id: c.text,
    title: c.text,
    brief: c.text,
    overview: [c.md, false],
    complete: [c.md, false],
    board: (v, at) => c.oneOf(v, at, BOARDS),
    licence: [c.text, false],
    avatar: [c.asset, false],
    assets: [c.assets, false],
    missions: (v, at) => c.list(v, at, c.mission),
  })
  // Images are checked once every asset name is known.
  c.assetNames = new Set(Object.keys(isObject(raw.assets) ? raw.assets : {}))
  c.finish()
  return withDefaults(raw)
}

/** The second file of a split pack: its id, the mission it continues after, its missions. */
export function readRest(text) {
  const raw = parse(text)
  const c = new Checker()
  c.fields(raw, '', {
    format: c.format,
    id: c.text,
    continues: c.text,
    assets: [c.assets, false],
    missions: (v, at) => c.list(v, at, c.mission),
  })
  c.finish()
  return raw
}

/**
 * A pack with its rest: the rest's missions after the pack's. The rest must
 * be this pack's and continue from its last mission; its board is the
 * pack's, and its images are the pack's and its own.
 */
export function joinRest(pack, rest) {
  const problems = []
  if (rest.id !== pack.id) problems.push(`id: the rest is of pack ${rest.id}, not ${pack.id}`)
  const last = pack.missions.at(-1)?.id
  if (rest.continues !== last) problems.push(`continues: the rest follows ${rest.continues}, but this pack ends with ${last}`)
  const assets = { ...pack.assets, ...rest.assets }
  const joined = { ...pack, missions: [...pack.missions, ...rest.missions], ...(Object.keys(assets).length ? { assets } : {}) }
  const seen = new Map()
  allIds(joined).forEach(([id, at]) => (seen.has(id) ? problems.push(`${at}: id ${id} is also at ${seen.get(id)}`) : seen.set(id, at)))
  if (problems.length) throw new PackError(problems)
  // The rest's Markdown may use the pack's images and its own; it was checked without them.
  const c = new Checker()
  c.assetNames = new Set(Object.keys(assets))
  rest.missions.forEach((m, i) => c.mission(m, `missions[${pack.missions.length + i}]`))
  c.finish()
  return withDefaults(joined)
}

// --------------------------------------------------------------- the checks

function parse(text) {
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new PackError([`not a pack file: ${err.message}`])
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/

class Checker {
  constructor() {
    this.problems = []
    this.ids = new Map()
    this.images = [] // [name, at]: checked in finish(), once the assets are known
    this.assetNames = null
    // Each check is (value, where); the methods are bound so tables can name them.
    for (const name of Object.getOwnPropertyNames(Checker.prototype)) {
      if (name !== 'constructor' && typeof this[name] === 'function') this[name] = this[name].bind(this)
    }
  }

  problem(at, what) {
    this.problems.push(`${at || 'pack'}: ${what}`)
  }

  finish() {
    if (this.assetNames) {
      for (const [name, at] of this.images) {
        if (!this.assetNames.has(name)) this.problem(at, `no image ${name} in assets`)
      }
    }
    if (this.problems.length) throw new PackError(this.problems)
  }

  /** An object with these fields, each `check` or `[check, required]`, and no others. */
  fields(value, at, spec) {
    if (!isObject(value)) return this.problem(at, 'should be an object')
    for (const [key, entry] of Object.entries(spec)) {
      const [check, required] = Array.isArray(entry) ? entry : [entry, true]
      const where = at ? `${at}.${key}` : key
      if (value[key] === undefined) {
        if (required) this.problem(where, 'missing')
      } else check(value[key], where)
    }
    for (const key of Object.keys(value)) {
      if (!(key in spec)) this.problem(at ? `${at}.${key}` : key, 'not a field of the format')
    }
  }

  list(value, at, each, { min = 1 } = {}) {
    if (!Array.isArray(value)) return this.problem(at, 'should be a list')
    if (value.length < min) this.problem(at, `should have at least ${min}`)
    value.forEach((v, i) => each(v, `${at}[${i}]`))
  }

  format(v, at) {
    if (!Number.isInteger(v) || v < 1) this.problem(at, 'should be a format number')
    else if (v > FORMAT) this.problem(at, `format ${v} needs a newer ${BRAND.name} (this one reads ${FORMAT})`)
  }

  text(v, at) {
    if (typeof v !== 'string' || !v.trim()) this.problem(at, 'should be text')
  }

  number(v, at) {
    if (typeof v !== 'number' || !(v >= 0)) this.problem(at, 'should be a number, 0 or more')
  }

  whole(v, at) {
    if (!Number.isInteger(v) || v < 0) this.problem(at, 'should be a whole number, 0 or more')
  }

  yes(v, at) {
    if (typeof v !== 'boolean') this.problem(at, 'should be true or false')
  }

  oneOf(v, at, choices) {
    if (!choices.includes(v)) this.problem(at, `should be one of ${choices.join(', ')}`)
  }

  id(v, at) {
    this.text(v, at)
    if (typeof v !== 'string') return
    if (this.ids.has(v)) this.problem(at, `id ${v} is also at ${this.ids.get(v)}`)
    else this.ids.set(v, at)
  }

  regex(v, at) {
    this.text(v, at)
    try {
      new RegExp(v)
    } catch {
      return this.problem(at, 'is not a regular expression')
    }
    const risk = riskyRegex(v)
    if (risk) this.problem(at, `could take forever to match: it has ${risk}`)
  }

  python(v, at) {
    if (typeof v !== 'string') return this.problem(at, 'should be Python, as text')
    const { root } = tree(v)
    if (root.error) this.problem(at, `Python does not parse at line ${root.error.line}`)
    return root
  }

  pattern(v, at) {
    this.text(v, at)
    if (typeof v !== 'string') return
    const root = this.python(v, at)
    if (root && !root.error && root.children.length !== 1) this.problem(at, 'a pattern is one statement or expression (use order for several)')
  }

  asset(v, at) {
    this.text(v, at)
    if (typeof v === 'string') this.images.push([v, at])
  }

  assets(v, at) {
    if (!isObject(v)) return this.problem(at, 'should be an object of images by name')
    for (const [name, url] of Object.entries(v)) {
      if (typeof url !== 'string' || !IMAGE.test(url)) this.problem(`${at}.${name}`, 'should be a data: URL of a PNG, JPEG, GIF or WebP image')
    }
  }

  /** Markdown: sections known and closed in order, images from the pack. */
  md(v, at) {
    if (typeof v !== 'string') return this.problem(at, 'should be Markdown, as text')
    const open = []
    for (const [, close, name, rest, selfClosed] of v.matchAll(/--(\/?)([A-Za-z]+)([^\n]*?)(\/?)--/g)) {
      if (name === 'File') {
        if (!selfClosed || !/^\s*title=\{[^}]+\}\s*$/.test(rest)) this.problem(at, 'write a new file as --File title={name}/--')
        continue
      }
      if (!SECTIONS.includes(name)) {
        this.problem(at, `no section --${name}--`)
        continue
      }
      if (rest.trim() || selfClosed) {
        this.problem(at, `--${name}-- takes nothing more`)
        continue
      }
      if (!close) open.push(name)
      else if (open.at(-1) === name) open.pop()
      else this.problem(at, `--/${name}-- closes ${open.length ? `--${open.at(-1)}--` : 'nothing'}`)
    }
    if (open.length) this.problem(at, `--${open.at(-1)}-- is not closed`)
    for (const [, src] of v.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) this.images.push([src, at])
  }

  mission(v, at) {
    this.fields(v, at, {
      id: this.id,
      title: this.text,
      brief: [this.text, false],
      overview: [this.md, false],
      complete: [this.md, false],
      avatar: [this.asset, false],
      flow: (f, where) => this.list(f, where, this.step),
    })
  }

  step(v, at) {
    if (!isObject(v)) return this.problem(at, 'should be an object')
    if (v.type === 'objective') this.objective(v, at)
    else if (v.type === 'quiz') this.quiz(v, at)
    else this.problem(`${at}.type`, 'should be objective or quiz')
  }

  objective(v, at) {
    this.fields(v, at, {
      type: () => {},
      id: this.id,
      title: this.text,
      xp: [this.whole, false],
      board: [(b, where) => this.oneOf(b, where, BOARDS), false],
      instructions: this.md,
      code: [this.python, false],
      solution: [this.python, false],
      trek: [(t, where) => this.list(t, where, (chunk, w) => this.fields(chunk, w, { md: this.md, python: this.python })), false],
      goals: (g, where) => this.list(g, where, (goal, w) => this.fields(goal, w, { md: this.md, check: this.check })),
      hints: [(h, where) => this.list(h, where, this.md, { min: 0 }), false],
      complete: [this.md, false],
      blocks: [this.yes, false],
      sim: [(s, where) => this.fields(s, where, { room: [this.text, false], course: [this.text, false] }), false],
    })
    if (Array.isArray(v.hints) && v.hints.length > 3) this.problem(`${at}.hints`, 'three at most')
  }

  quiz(v, at) {
    this.fields(v, at, {
      type: () => {},
      id: this.id,
      title: this.text,
      overview: [this.md, false],
      complete: [this.md, false],
      questions: (q, where) => this.list(q, where, this.question),
    })
  }

  question(v, at) {
    this.fields(v, at, {
      id: this.id,
      q: this.md,
      xp: [this.whole, false],
      answers: (a, where) =>
        this.list(a, where, (answer, w) => this.fields(answer, w, { a: this.md, correct: [this.yes, false] }), { min: 2 }),
    })
    if (Array.isArray(v?.answers) && !v.answers.some((a) => a?.correct === true)) this.problem(`${at}.answers`, 'none is correct')
  }

  /** A goal's check: exactly one kind, with that kind's fields. */
  check(v, at) {
    if (!isObject(v)) return this.problem(at, 'should be a check')
    const kinds = Object.keys(CHECKS).filter((k) => k in v)
    if (kinds.length !== 1) return this.problem(at, `should be one check of ${Object.keys(CHECKS).join(', ')}`)
    this.fields(v, at, CHECKS[kinds[0]](this))
    if (v.min !== undefined && v.max !== undefined && v.max < v.min) this.problem(at, 'max is less than min')
    if (v.event === 'file-created' && v.name === undefined) this.problem(at, 'file-created needs the file\'s name')
    if (v.event !== undefined && v.event !== 'file-created' && v.name !== undefined) this.problem(`${at}.name`, `${v.event} takes no name`)
  }
}

/** Each check kind's fields, keyed by the field that names the kind. */
const CHECKS = {
  has: (c) => ({ has: c.pattern, min: [c.whole, false], max: [c.whole, false], in: [c.pattern, false] }),
  order: (c) => ({ order: (v, at) => c.list(v, at, c.pattern, { min: 2 }) }),
  all: (c) => ({ all: (v, at) => c.list(v, at, c.check) }),
  any: (c) => ({ any: (v, at) => c.list(v, at, c.check) }),
  prints: (c) => ({ prints: c.regex }),
  runs: (c) => ({ runs: (v, at) => (v === true ? null : c.problem(at, 'should be true')), seconds: [c.number, false] }),
  event: (c) => ({
    event: (v, at) => c.oneOf(v, at, EVENTS),
    name: [c.text, false],
  }),
  pick: (c) => ({ pick: c.regex }),
}

// --------------------------------------------------------------- the result

function allIds(pack) {
  const out = []
  pack.missions.forEach((m, i) => {
    out.push([m.id, `missions[${i}]`])
    m.flow.forEach((s, j) => {
      out.push([s.id, `missions[${i}].flow[${j}]`])
      s.questions?.forEach((q, k) => out.push([q.id, `missions[${i}].flow[${j}].questions[${k}]`]))
    })
  })
  return out
}

/** Fields that hold code, checks or names of things, where `{app}` is left as written. */
const NOT_WORDS = new Set(['id', 'board', 'code', 'solution', 'python', 'check', 'assets', 'avatar', 'sim', 'format', 'continues'])

/**
 * The pack's words with `{app}` as the product's name (src/brand.js): titles,
 * briefs, Markdown, captions, quizzes. A pack is kept as its file's text and
 * read afresh each time, so a renamed product reads right in packs kept before.
 */
export function named(value, key = '') {
  if (NOT_WORDS.has(key)) return value
  if (typeof value === 'string') return value.replaceAll('{app}', BRAND.name)
  if (Array.isArray(value)) return value.map((v) => named(v))
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, named(v, k)]))
  return value
}

function withDefaults(raw) {
  const pack = named(raw)
  return {
    ...pack,
    missions: pack.missions.map((m) => ({
      ...m,
      flow: m.flow.map((s) => (s.type === 'objective' ? { xp: 5, board: pack.board, ...s } : s)),
    })),
  }
}
