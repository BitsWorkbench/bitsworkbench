/**
 * Mission packs, read and checked, with no browser: a good pack reads with its
 * defaults filled in, each kind of mistake is named with where it is, and a
 * pack split in two joins back into one.
 */
import { readPack, readRest, joinRest, PackError, FORMAT } from '../src/learn/pack.js'
import { renderMarkdown } from '../src/learn/markdown.js'

let failures = 0
const check = (name, condition, detail = '') => {
  if (condition) console.log(`  ok  ${name}`)
  else {
    console.log(`  FAIL ${name} ${detail}`)
    failures++
  }
}

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const objective = (id, more = {}) => ({
  type: 'objective',
  id,
  title: 'Lights On',
  instructions: '--Concept--\nThe **LEDs**.\n--/Concept--\n--Blocks--Drag the block.--/Blocks----Python--Type the line.--/Python--\n![The LEDs](leds.png)',
  code: 'from botcore import *\n\nleds.user(0b11110000)\n',
  solution: 'from botcore import *\n\nleds.user(0b11111111)\n',
  trek: [{ md: 'All on.', python: 'leds.user(0b11111111)\npass  # TODO: and the next\n' }],
  goals: [
    { md: 'All on', check: { has: 'leds.user(0b11111111)' } },
    { md: 'In a loop', check: { has: 'leds.user(...)', in: 'while True: ...', min: 1 } },
    { md: 'In order', check: { order: ['motors.enable(True)', 'motors.run(LEFT, ...)'] } },
    { md: 'Both', check: { all: [{ prints: '^hello' }, { any: [{ runs: true, seconds: 2 }, { pick: 'LED' }] }] } },
    { md: 'Saved', check: { event: 'file-created', name: 'lights.py' } },
  ],
  hints: ['Look at the CodeTrek.'],
  complete: '## Bright idea!',
  ...more,
})

const quiz = (id) => ({
  type: 'quiz',
  id,
  title: 'Checkpoint',
  questions: [{ id: `${id}_Q1`, q: 'How many LEDs?', answers: [{ a: 'Four' }, { a: 'Eight', correct: true }] }],
})

const good = () => ({
  format: FORMAT,
  id: 'T',
  title: 'Test pack',
  brief: 'For the tests',
  board: 'codebot',
  avatar: 'leds.png',
  assets: { 'leds.png': PNG },
  missions: [
    { id: 'T_A', title: 'A', flow: [objective('T_A_1'), quiz('T_A_Quiz'), objective('T_A_2', { board: 'codex', xp: 10 })] },
    { id: 'T_B', title: 'B', flow: [objective('T_B_1')] },
  ],
})

/** The problems a pack has, [] when it reads. */
function problemsOf(raw, read = readPack) {
  try {
    read(JSON.stringify(raw))
    return []
  } catch (err) {
    if (!(err instanceof PackError)) throw err
    return err.problems
  }
}
const has = (problems, text) => problems.some((p) => p.includes(text))

console.log('A good pack')
{
  const pack = readPack(JSON.stringify(good()))
  const [a1, , a2] = pack.missions[0].flow
  check('reads', pack.id === 'T' && pack.missions.length === 2)
  check('an objective takes the pack\'s board and 5 xp', a1.board === 'codebot' && a1.xp === 5)
  check('an objective keeps its own board and xp', a2.board === 'codex' && a2.xp === 10)
  check('a quiz gets no board', pack.missions[0].flow[1].board === undefined)
}

console.log('Mistakes, each named where it is')
const mistakes = [
  ['not JSON', 'not a pack', () => '{', true],
  ['a newer format', 'needs a newer Codacious', (p) => ({ ...p, format: FORMAT + 1 })],
  ['a missing field', 'title: missing', (p) => ({ ...p, title: undefined })],
  ['a field not in the format', 'colour: not a field', (p) => ({ ...p, colour: 'red' })],
  ['an unknown board', 'board: should be one of', (p) => ({ ...p, board: 'microbit' })],
  ['a script in assets', 'assets.x.svg', (p) => ({ ...p, assets: { ...p.assets, 'x.svg': 'data:image/svg+xml;base64,PHN2Zz4=' } })],
  ['an image not in assets', 'no image gone.png', (p) => ({ ...p, avatar: 'gone.png' })],
  ['an id used twice', 'id T_A_1 is also at missions[0].flow[0]', (p) => (p.missions[1].flow.push(objective('T_A_1')), p)],
  ['starter code that does not parse', 'flow[0].code: Python does not parse at line 3', (p) => ((p.missions[0].flow[0].code = 'from botcore import *\n\nleds.user(\n'), p)],
  ['a pattern that does not parse', 'goals[0].check.has: Python does not parse', (p) => ((p.missions[0].flow[0].goals[0].check = { has: 'leds.user(' }), p)],
  ['two kinds in one check', 'should be one check of', (p) => ((p.missions[0].flow[0].goals[0].check = { has: 'x', prints: 'y' }), p)],
  ['a field of another check kind', 'goals[0].check.seconds: not a field', (p) => ((p.missions[0].flow[0].goals[0].check = { has: 'x', seconds: 1 }), p)],
  ['a bad regular expression', 'is not a regular expression', (p) => ((p.missions[0].flow[0].goals[0].check = { prints: '(' }), p)],
  ['a regular expression that can backtrack without end', 'could take forever to match: it has a repeat inside a repeat', (p) => ((p.missions[0].flow[0].goals[0].check = { prints: '(a+)+$' }), p)],
  ['a pattern of two statements', 'a pattern is one statement', (p) => ((p.missions[0].flow[0].goals[0].check = { has: 'x = 1\ny = 2' }), p)],
  ['an unknown event', 'should be one of edited', (p) => ((p.missions[0].flow[0].goals[0].check = { event: 'clicked' }), p)],
  ['a new file with no name', 'file-created needs', (p) => ((p.missions[0].flow[0].goals[0].check = { event: 'file-created' }), p)],
  ['max under min', 'max is less than min', (p) => ((p.missions[0].flow[0].goals[0].check = { has: 'x', min: 3, max: 1 }), p)],
  ['a quiz with no right answer', 'answers: none is correct', (p) => ((p.missions[0].flow[1].questions[0].answers[1].correct = false), p)],
  ['an unknown section', 'no section --Shout--', (p) => ((p.missions[0].overview = '--Shout--hi--/Shout--'), p)],
  ['a section left open', '--Peek-- is not closed', (p) => ((p.missions[0].overview = '--Peek--hi'), p)],
  ['sections crossed', '--/Blocks-- closes --Python--', (p) => ((p.missions[0].overview = '--Blocks----Python--x--/Blocks----/Python--'), p)],
  ['a new file with no title', 'write a new file as', (p) => ((p.missions[0].overview = '--File--'), p)],
  ['four hints', 'three at most', (p) => ((p.missions[0].flow[0].hints = ['a', 'b', 'c', 'd']), p)],
  ['an unknown step', 'flow[0].type: should be objective or quiz', (p) => ((p.missions[0].flow[0].type = 'video'), p)],
]
for (const [label, expected, change, rawText] of mistakes) {
  let problems
  if (rawText) {
    try {
      readPack(change())
      problems = []
    } catch (err) {
      problems = err.problems ?? []
    }
  } else problems = problemsOf(change(good()))
  check(label, has(problems, expected), JSON.stringify(problems))
}
{
  const p = good()
  p.title = undefined
  p.board = 'microbit'
  p.missions[0].flow[0].code = 'if'
  check('every problem is named, not just the first', problemsOf(p).length === 3, JSON.stringify(problemsOf(p)))
  check('a new file named in Markdown reads', problemsOf({ ...good(), overview: 'Now --File title={my-lights.py}/-- please' }).length === 0)
}

console.log('A pack in two files')
{
  const whole = good()
  const sampler = { ...whole, missions: [whole.missions[0]] }
  const rest = { format: FORMAT, id: 'T', continues: 'T_A', missions: [whole.missions[1]] }
  const joined = joinRest(readPack(JSON.stringify(sampler)), readRest(JSON.stringify(rest)))
  check('joins into the whole pack', JSON.stringify(joined) === JSON.stringify(readPack(JSON.stringify(whole))))
  check('the rest\'s objectives take the pack\'s board', joined.missions[1].flow[0].board === 'codebot')

  const tryJoin = (s, r) => {
    try {
      joinRest(readPack(JSON.stringify(s)), readRest(JSON.stringify(r)))
      return []
    } catch (err) {
      return err.problems
    }
  }
  check('a rest of another pack is refused', has(tryJoin(sampler, { ...rest, id: 'U' }), 'the rest is of pack U'))
  check('a rest after another mission is refused', has(tryJoin(sampler, { ...rest, continues: 'T_Z' }), 'this pack ends with T_A'))
  check('an id in both parts is refused', has(tryJoin(sampler, { ...rest, missions: [{ ...whole.missions[1], id: 'T_A' }] }), 'id T_A is also at missions[0]'))
  const lost = { ...rest, missions: [{ ...whole.missions[1], flow: [objective('T_B_1', { instructions: '![gone](nope.png)' })] }] }
  check('the rest\'s images are checked against the pack\'s', has(tryJoin(sampler, lost), 'no image nope.png'))
  check('a rest has only its own fields', has(problemsOf({ ...rest, title: 'More' }, readRest), 'title: not a field'))
}

console.log('A pack\'s Markdown, as HTML')
{
  const assets = { 'leds.png': PNG }
  const html = (text, mode = 'blocks') => renderMarkdown(text, { mode, assets, label: (name, title) => (title ? `${name}:${title}` : name) })
  check('Markdown renders', html('**bold** and `code`') === '<p><strong>bold</strong> and <code>code</code></p>\n')
  const both = 'Now --Blocks--drag the block--/Blocks----Python--type the line--/Python-- please.'
  check('blocks mode keeps the Blocks text, inline', html(both) === '<p>Now drag the block please.</p>\n', html(both))
  check('Python mode keeps the Python text', html(both, 'python') === '<p>Now type the line please.</p>\n', html(both, 'python'))
  const raw = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>hi</b>')
  check('HTML in a pack is shown as text, never run', !/<script|<img|<b>/.test(raw) && raw.includes('&lt;script&gt;'), raw)
  const links = html('[web](https://firialabs.com) [bad](javascript:alert(1)) [data](data:text/html,hi)')
  check('a web link opens in a new tab', links.includes('<a href="https://firialabs.com" target="_blank" rel="noopener noreferrer">web</a>'), links)
  check('no javascript: or data: link', !/href="(javascript|data):/i.test(links), links)
  check('an image is the pack\'s own', html('![The LEDs](leds.png)') === `<p><img src="${PNG}" alt="The LEDs"></p>\n`, html('![The LEDs](leds.png)'))
  check('an image from anywhere else is left out', !html('![x](https://example.com/x.png) ![y](nope.png)').includes('<img'))
  const panel = html('Before\n\n--Concept--\nThe **LEDs**.\n--/Concept--\n\nAfter')
  check('a section is a labelled panel', /<p>Before<\/p>\n<div class="lsec lsec-concept"><p class="lsec-label">Concept<\/p><p>The <strong>LEDs<\/strong>.<\/p>\n<\/div><p>After<\/p>/.test(panel), panel)
  check('a Peek section is folded', html('--Peek--hidden--/Peek--').startsWith('<details class="lsec lsec-peek"><summary>Peek</summary>'))
  check('a new file names the file', html('--File title={blink.py}/--').includes('File:blink.py'))
  check('sections inside sections', /lsec-concept.*lsec-caution.*inner/s.test(html('--Concept--a--Caution--inner--/Caution--b--/Concept--')))
}

if (failures) {
  console.log(`\n${failures} failed`)
  process.exit(1)
}
console.log('\nall passed')
