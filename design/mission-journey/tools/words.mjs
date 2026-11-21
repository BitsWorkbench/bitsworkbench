/**
 * Reading load: the words a student in blocks mode is shown, per objective of CodeX
 * mission 1 today and per step of the same mission as a journey.
 *   node words.mjs     (writes ../words.json)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../../..')
const words = (md) =>
  String(md || '')
    .replace(/--Python--[\s\S]*?--\/Python--/g, ' ')
    .replace(/--\/?[A-Za-z]+--/g, ' ')
    .replace(/[#*>`_\-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length

const lcx = JSON.parse(readFileSync(join(REPO, 'public/learn/packs/LCX.json'), 'utf8'))
const journey = JSON.parse(readFileSync(join(HERE, '../proto/welcome.journey.json'), 'utf8'))
const out = { today: [], journey: [] }

for (const mi of [0, 2]) {
  const m = lcx.missions[mi]
  const rows = [{ mission: m.title, part: 'Mission overview', words: words(m.overview) }]
  for (const f of m.flow) {
    if (f.type === 'objective') {
      rows.push({
        mission: m.title,
        part: f.title,
        instructions: words(f.instructions),
        goals: f.goals.reduce((n, g) => n + words(g.md), 0),
        complete: words(f.complete),
        trek: (f.trek || []).reduce((n, t) => n + words(t.md), 0),
        words: words(f.instructions) + f.goals.reduce((n, g) => n + words(g.md), 0) + words(f.complete),
      })
    } else {
      rows.push({ mission: m.title, part: `Quiz: ${f.title}`, words: words(f.overview) + f.questions.reduce((n, q) => n + words(q.q) + q.answers.reduce((k, a) => k + words(a.a), 0), 0) })
    }
  }
  rows.push({ mission: m.title, part: 'Mission complete', words: words(m.complete) })
  out.today.push(...rows)
}

out.journey.push({ part: 'Opening card', words: words(journey.title) + words(journey.promise) })
for (const s of journey.steps) {
  const say = words(s.say || s.ask) + (s.answers || []).reduce((n, a) => n + words(a.a), 0)
  out.journey.push({ part: s.id, say, cheer: words(s.cheer), card: words(s.show?.caption), optional: (s.hints || []).reduce((n, h) => n + words(h), 0), words: say + words(s.cheer) + words(s.show?.caption) })
}
out.journey.push({ part: 'Finish card', words: words(journey.complete.say), optional: words(journey.complete.more) })
const sum = (rows, mission) => rows.filter((r) => !mission || r.mission === mission).reduce((n, r) => n + r.words, 0)
out.totals = {
  todayWelcome: sum(out.today, 'Welcome'),
  todayWelcomeObjectives: out.today.filter((r) => r.mission === 'Welcome' && r.instructions != null).map((r) => r.words),
  todayLightShow: sum(out.today, 'Light Show'),
  journey: sum(out.journey),
  journeyMaxStep: Math.max(...out.journey.map((r) => r.words)),
  journeyOptional: out.journey.reduce((n, r) => n + (r.optional || 0), 0),
}
writeFileSync(join(HERE, '../words.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(out.totals))
console.table(out.today.map((r) => [r.mission, r.part, r.words]))
console.table(out.journey.map((r) => [r.part, r.words]))
