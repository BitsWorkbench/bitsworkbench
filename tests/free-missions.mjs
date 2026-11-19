// The free first missions that come with the app, objective by objective, with
// no browser: can each one be finished in the simulator?
//
// The packs carry no answer key (tests/learn-pack.mjs), so the program an
// objective builds toward is taken from the pack itself: the next objective's
// starting code ("the student's program from the objective before",
// docs/mission-packs.md), or the objective's own code with its CodeTrek added.
// Then:
//   - a `pick` goal names a part the board's model has (a failure);
//   - the program runs in the simulator on its board without an error (a
//     failure), and a `prints` goal that needs no button or sensor sees its line;
//   - its code checks (has, order) are met by one of those programs. One met by
//     neither is reported, not failed: the student writes that part, and only an
//     answer key could show it can be done.
// Run after `npm run build` (the models' parts lists). CodeAIR's programs fly
// only with its flight library (SIM_FLIGHT=1). `node tests/free-missions.mjs
// --report` prints every objective and what was, and was not, checked.
import { readFileSync } from 'node:fs'
import { runHeadless, haveFlight } from '../src/sim/headless.js'
import { met } from '../src/learn/checks.js'
import { readPack } from '../src/learn/pack.js'

const REPORT = process.argv.includes('--report')
const dir = new URL('../public/learn/packs/', import.meta.url)
const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'))
const PARTS = {
  codebot: 'codebot-body.parts.json',
  codex: 'codex.parts.json',
  codeair: 'codeair.parts.json',
}
const partsOf = (board) => {
  try {
    const parts = JSON.parse(readFileSync(new URL(`../public/sim-assets/models/${PARTS[board]}`, import.meta.url), 'utf8'))
    const names = parts.map((p) => p.name)
    // CodeBot's LEDs are the figure's own, not the model's (src/sim/view/codebot-figure.js).
    if (board === 'codebot') for (const [group, n] of [['user', 8], ['ls', 5], ['prox', 2], ['pwr', 1]]) for (let i = 0; i < n; i++) names.push(`LED_${group}_${i}`)
    return names
  } catch {
    return null
  }
}

let failures = 0
const rows = []
const leaves = (check) => (check.all || check.any ? (check.all || check.any).flatMap(leaves) : [check])
const isCode = (c) => 'has' in c || 'order' in c

for (const entry of index) {
  const text = readFileSync(new URL(entry.file, dir), 'utf8')
  const pack = readPack(text)
  const files = new Set([...text.matchAll(/File title=\{([^},]+)/g)].map((m) => m[1]))
  for (const mission of pack.missions) {
    const objectives = mission.flow.filter((f) => f.type === 'objective')
    for (const [i, obj] of objectives.entries()) {
      const board = obj.board || pack.board
      // What the objective builds toward: the next one's starting code, or its own code with its CodeTrek added.
      const trek = obj.trek?.length ? [obj.code ?? '', ...obj.trek.map((t) => t.python)].join('\n') : null
      const candidates = [objectives[i + 1]?.code, trek].filter((c) => c != null)
      const program = candidates[0] ?? null
      const checks = obj.goals.flatMap((g) => leaves(g.check))
      const kinds = [...new Set(checks.map((c) => Object.keys(c).find((k) => ['has', 'order', 'prints', 'runs', 'event', 'pick'].includes(k))))]
      const row = { pack: pack.id, mission: mission.id, objective: obj.id, board, kinds: kinds.join(','), result: [], problems: [], unproven: [] }
      rows.push(row)

      for (const c of checks.filter((c) => 'pick' in c)) {
        const parts = partsOf(board)
        if (!parts) row.result.push('pick: no parts list')
        else if (!parts.some((p) => new RegExp(c.pick).test(p))) row.problems.push(`pick ${c.pick}: no part of the ${board} model matches`)
      }
      if (program == null) {
        row.result.push(checks.some(isCode) || checks.some((c) => 'prints' in c || 'runs' in c) ? 'program not known (last objective)' : 'nothing needs the program')
        continue
      }
      const seenOf = (program) => ({ program, runs: [], events: [], printed: new Set(), picked: new Set() })
      for (const [g, goal] of obj.goals.entries()) {
        const code = leaves(goal.check).every(isCode)
        if (code && !candidates.some((c) => met(goal.check, seenOf(c)))) row.unproven.push(`goal ${g + 1} (${goal.md.replace(/\s+/g, ' ').slice(0, 60)})`)
      }
      if (!checks.some((c) => 'prints' in c || 'runs' in c)) {
        row.result.push('code checks')
        continue
      }
      // A module the student wrote in an earlier objective (`--File title={safety.py}/--`) is
      // theirs, not the pack's: Run puts it beside the program in the app (tests/files.mjs).
      const theirs = [...program.matchAll(/^\s*(?:from|import)\s+(\w+)/gm)].map((m) => m[1]).filter((name) => files.has(`${name}.py`))
      if (theirs.length) {
        row.result.push(`run not tried: needs the student's ${theirs.map((n) => `${n}.py`).join(', ')}`)
        continue
      }
      if (board === 'codeair' && !haveFlight()) {
        row.result.push('run skipped: no CodeAIR flight library (SIM_FLIGHT=1 npm run sim:flight)')
        continue
      }
      let r
      try {
        r = await runHeadless({ source: program, kind: board, env: board === 'codex' ? 'empty' : 'gym', seconds: 20, seed: 1 })
      } catch (err) {
        row.problems.push(`does not start: ${err.message.split('\n')[0]}`)
        continue
      }
      if (r.error) {
        row.problems.push(`error: ${String(r.error.message ?? r.error).split('\n').slice(-2).join(' ').slice(0, 160)}`)
        continue
      }
      const lines = r.output.split(/\r?\n/)
      for (const c of checks.filter((c) => 'prints' in c)) {
        if (!lines.some((l) => new RegExp(c.prints).test(l))) row.result.push(`prints ${c.prints}: not seen in 20 s with no input (may need a button or a sensor)`)
      }
      row.result.push(`ran ${r.simSeconds.toFixed(1)} s${r.timedOut ? ' (stopped)' : ''}`)
    }
  }
}

let unproven = 0
for (const row of rows) {
  if (row.problems.length) failures++
  if (row.unproven.length) unproven++
  const unp = row.unproven.length ? [`code goals not shown reachable from the pack alone: ${row.unproven.join(', ')}`] : []
  if (REPORT || row.problems.length) {
    console.log(`${row.problems.length ? 'FAIL' : row.unproven.length ? ' ?? ' : ' ok '} ${row.pack} ${row.objective} [${row.board}; ${row.kinds}] ${[...row.result, ...unp, ...row.problems].join('; ')}`)
  }
}
console.log(`\n${rows.length} objectives: ${failures} with problems, ${unproven} with code goals the pack alone cannot show are reachable (no answer key)`)
process.exit(failures ? 1 : 0)
