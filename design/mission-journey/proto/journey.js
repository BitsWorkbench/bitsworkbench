/**
 * Mission journey prototypes. One engine for the four directions (A to D), drawn
 * over screenshots of the real OpenCodeBot (proto/backdrops, made by
 * tools/capture.mjs) with real buttons over the controls that matter.
 *
 * The page sets window.DIRECTION ('A'..'D') and window.JOURNEY_DATA:
 * { anchors, backdrops: { '<size>-<state>': url }, journey, es, lcx }.
 * A and B play CodeX mission 1 as it is today (its objectives, from LCX.json);
 * C and D play the same mission rewritten as steps (welcome.journey.json).
 */
const DATA = window.JOURNEY_DATA
const DIR = window.DIRECTION
const qs = new URLSearchParams(location.search)
const $ = (s, r = document) => r.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const APP = 'OpenCodeBot'

let size = qs.get('size') || (innerWidth < 640 ? 'phone' : innerWidth < 1250 ? 'ipad' : 'chromebook')
let lang = qs.get('lang') === 'es' && DIR >= 'C' ? 'es' : 'en'
let reduce = qs.get('motion') === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------------- words ---------------- */
const UI = {
  en: { step: 'Step {n} of {m}', next: 'Next ›', back: '‹ Back', showMe: 'Show me', hint: 'Hint', more: 'Tell me more', less: 'Less', go: "Let's go", skip: 'Skip', done: 'Mission complete!', again: 'Not quite. Try again.', nextMission: 'Next mission ›', readMore: 'Read more', objective: 'Objective', mission: 'Mission 1', goals: 'Goals', complete: 'complete!', hide: 'Hide goals', show: 'Show goals', quiz: 'Quiz', yourCode: 'Your program' },
  es: { step: 'Paso {n} de {m}', next: 'Siguiente ›', back: '‹ Atrás', showMe: 'Muéstrame', hint: 'Pista', more: 'Cuéntame más', less: 'Menos', go: '¡Vamos!', skip: 'Saltar', done: '¡Misión cumplida!', again: 'Casi. Inténtalo otra vez.', nextMission: 'Siguiente misión ›', readMore: 'Leer más', objective: 'Objetivo', mission: 'Misión 1', goals: 'Metas', complete: '¡completado!', hide: 'Ocultar metas', show: 'Mostrar metas', quiz: 'Prueba', yourCode: 'Tu programa' },
}
const t = (k, v = {}) => UI[lang][k].replace(/\{(\w+)\}/g, (_, x) => v[x])

/** A little Markdown: headings, lists, quotes, CodeSpace sections, bold, italic, code. Blocks mode. */
function md(src) {
  let s = String(src).replace(/\{app\}/g, APP)
  s = s.replace(/--Python--[\s\S]*?--\/Python--/g, '').replace(/--\/?Blocks--/g, '\n')
  const inline = (x) =>
    esc(x)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const out = []
  let list = null
  const flush = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`)
    list = null
  }
  for (const raw of s.split('\n')) {
    const line = raw.trimEnd()
    let m
    if ((m = line.match(/^--(Concept|Caution|Peek|Remix|Run|Debug|Touch)--$/))) { flush(); out.push('<div class="concept">'); continue }
    if (/^--\/(Concept|Caution|Peek|Remix|Run|Debug|Touch)--$/.test(line)) { flush(); out.push('</div>'); continue }
    if ((m = line.match(/^(#{1,3}) (.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue }
    if ((m = line.match(/^\s*(?:[-*]|(\d+)\.) (.*)/))) {
      const tag = m[1] ? 'ol' : 'ul'
      if (!list || list.tag !== tag) { flush(); list = { tag, items: [] } }
      list.items.push(m[2]); continue
    }
    flush()
    if ((m = line.match(/^> ?(.*)/))) { out.push(`<p><em>${inline(m[1])}</em></p>`); continue }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  flush()
  return `<div class="md">${out.join('')}</div>`
}

/* ---------------- the app being simulated ---------------- */
const S = { named: false, lights: false, ran: false, view: 'blocks', flyout: false, typed: 'Hi there!' }
const ANC = () => (DIR === 'A' ? { ...DATA.anchors[size], ...DATA.anchors[size].A } : DATA.anchors[size])
function backdrop() {
  const p = DIR === 'A' ? 'a-' : ''
  let st
  if (S.view === 'python') st = S.lights ? 'python' : 'pythonstart'
  else if (S.flyout) st = 'lights'
  else if (S.lights) st = S.ran ? 'ran' : 'added'
  else if (S.named) st = S.ran ? 'namedran' : 'named'
  else st = S.ran ? 'startran' : 'start'
  return DATA.backdrops[`${size}-${p}${st}`]
}

/** A named place on screen, [x, y, w, h], in the stage's pixels. Authors name places, never selectors. */
function anchor(name) {
  const a = ANC()
  const [kind, arg] = name.split(/:(.*)/s)
  const c = a.canvas
  const sim = (x, y, w = 0, h = 0) => {
    const k = c[3] / 379
    return [c[0] + c[2] / 2 + (x - 209.5) * k, c[1] + y * k, w * k, h * k]
  }
  switch (kind) {
    case 'run': return a.run
    case 'switch': return a.view
    case 'palette': return a.lights
    case 'palette-item': return a.flyout[1]
    case 'field': return a.start.textField
    case 'sim': return c
    case 'screen': return sim(159, 129, 58, 64)
    case 'part': return sim(193, 122, 0, 0) // the LEDs as a group: see leds()
    case 'block': {
      if (arg.startsWith('pixels')) return a.added.lastBlock
      if (!S.lights) return a.start.lastBlock
      const l = a.added.lastBlock
      return [l[0], l[1] - l[3] + 4, l[2] - 50, l[3] - 4]
    }
    case 'after': {
      const l = a.start.lastBlock
      const f = a.flyout[1]
      return [l[0], l[1] + l[3] - 8, f[2] * 0.9, f[3]]
    }
    default: return c
  }
}
function leds() {
  const a = ANC()
  const c = a.canvas
  const k = c[3] / 379
  return [[106, 130], [117, 114], [265, 115], [281, 131]].map(([x, y]) => [c[0] + c[2] / 2 + (x - 209.5) * k, c[1] + y * k])
}

/* ---------------- stage ---------------- */
const stage = $('#stage')
const bd = $('#bd')
const hot = $('#hot')
const ui = $('#ui')
const fx = $('#fx')
const live = $('#live')
function fit() {
  const a = DATA.anchors[size]
  stage.style.width = a.width + 'px'
  stage.style.height = a.height + 'px'
  const vp = $('#viewport').getBoundingClientRect()
  const k = Math.min((vp.width - 16) / a.width, (vp.height - 16) / a.height, 1.25)
  stage.style.transform = `scale(${k})`
  stage.dataset.scale = k
}
addEventListener('resize', fit)
const pos = (el, [x, y, w, h]) => Object.assign(el.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' })
const announce = (text) => {
  live.textContent = ''
  setTimeout(() => (live.textContent = text.replace(/[*`]/g, '')), 60)
}

/* ---------------- hotspots: real buttons where the screenshot has controls ---------------- */
function drawHot() {
  const a = ANC()
  const had = document.activeElement?.dataset?.hot
  hot.innerHTML = ''
  const add = (id, box, label, extra = '') => {
    if (!box) return
    const b = document.createElement('button')
    b.className = 'hot ' + extra
    b.dataset.hot = id
    b.setAttribute('aria-label', label)
    b.title = label
    pos(b, box)
    hot.append(b)
    return b
  }
  add('run', a.run, 'Run')
  add('view', a.view, S.view === 'blocks' ? 'Blocks or Python: now Blocks' : 'Blocks or Python: now Python')
  if (S.view === 'blocks') {
    add('lights', a.lights, 'Lights blocks', '')?.setAttribute('aria-expanded', S.flyout)
    if (S.flyout) add('item', a.flyout[1], 'Block: set all neopixels. Enter adds it to your program; or drag it.')
    else if (!S.lights) add('field', a.start.textField, `Text in the show block: ${S.typed}`)
  }
  add('sim', a.canvas, 'Simulated CodeX. Drag to turn it; arrow keys too.', 'sim')
  if (had) hot.querySelector(`[data-hot="${had}"]`)?.focus()
}

let drag = null
hot.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.hot')
  if (!b) return
  const k = Number(stage.dataset.scale)
  const sr = stage.getBoundingClientRect()
  const p = (ev) => [(ev.clientX - sr.left) / k, (ev.clientY - sr.top) / k]
  drag = { id: b.dataset.hot, start: p(e), moved: false, p }
  if (drag.id === 'item' && !e.isPrimary) drag = null
  b.setPointerCapture?.(e.pointerId)
})
hot.addEventListener('pointermove', (e) => {
  if (!drag) return
  const [x, y] = drag.p(e)
  if (Math.hypot(x - drag.start[0], y - drag.start[1]) > 10) drag.moved = true
  if (drag.id === 'item' && drag.moved) {
    const f = ANC().flyout[1]
    if (!drag.el) {
      drag.el = document.createElement('div')
      drag.el.className = 'flyghost'
      Object.assign(drag.el.style, ghostStyle(f))
      fx.append(drag.el)
    }
    drag.el.style.left = x - (drag.start[0] - f[0]) + 'px'
    drag.el.style.top = y - (drag.start[1] - f[1]) + 'px'
  }
  if (drag.id === 'sim' && drag.moved && !drag.orbited) {
    drag.orbited = true
    emit('orbit')
  }
})
hot.addEventListener('pointerup', (e) => {
  if (!drag) return
  const d = drag
  drag = null
  d.el?.remove()
  if (d.id === 'item') {
    // A prototype: a click or any drag out of the palette puts the block in place.
    act('item')
    return
  }
  if (!d.moved) act(d.id, d.p(e))
})
hot.addEventListener('keydown', (e) => {
  const b = e.target.closest('.hot')
  if (!b) return
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(b.dataset.hot) }
  if (b.dataset.hot === 'sim' && e.key.startsWith('Arrow')) { e.preventDefault(); emit('orbit') }
})

function ghostStyle(f) {
  const lights = DATA.backdrops[`${size}-${DIR === 'A' ? 'a-' : ''}lights`]
  const a = DATA.anchors[size]
  return {
    left: f[0] + 'px', top: f[1] + 'px', width: f[2] + 'px', height: f[3] + 'px',
    backgroundImage: `url(${lights})`, backgroundSize: `${a.width}px ${a.height}px`, backgroundPosition: `-${f[0]}px -${f[1]}px`,
  }
}

/** What a click on the fake app does to the fake program. */
function act(id, at) {
  switch (id) {
    case 'run':
      S.flyout = false
      S.ran = true
      emit('runs')
      break
    case 'view':
      S.view = S.view === 'blocks' ? 'python' : 'blocks'
      S.flyout = false
      emit('switched')
      break
    case 'lights':
      S.flyout = !S.flyout
      if (S.flyout) emit('palette', 'Lights')
      else render()
      break
    case 'item':
      S.lights = true
      S.flyout = false
      S.ran = false
      emit('edited')
      break
    case 'field':
      editField()
      break
    case 'sim': {
      if (at && leds().some(([x, y]) => Math.hypot(at[0] - x, at[1] - y) < 14)) emit('pick', 'Neo_0')
      break
    }
  }
}

function editField() {
  const f = ANC().start.textField
  const inp = document.createElement('input')
  inp.className = 'input-pop'
  inp.value = S.typed
  inp.setAttribute('aria-label', 'Text to show on the screen')
  inp.style.left = f[0] - 6 + 'px'
  inp.style.top = f[1] - 4 + 'px'
  ui.append(inp)
  inp.focus()
  inp.select()
  let done = false
  const commit = () => {
    if (done) return
    done = true
    const v = inp.value.trim()
    inp.remove()
    if (v && v !== S.typed) {
      S.typed = v
      S.named = v !== 'Hi there!'
      S.ran = false
      emit('edited')
    } else render()
    hot.querySelector('[data-hot="field"]')?.focus()
  }
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') { inp.value = S.typed; commit() }
  })
  inp.addEventListener('blur', commit)
}

/* ---------------- checks: the same vocabulary packs use today ---------------- */
function met(check, ev) {
  if (check.all) return check.all.every((c) => met(c, ev))
  if (check.any) return check.any.some((c) => met(c, ev))
  if (check.event) return ev && ev.type === check.event && (!check.name || ev.detail === check.name)
  if (check.runs) return ev && ev.type === 'runs'
  if (check.pick) return ev && ev.type === 'pick'
  if (check.has) {
    const has = /pixels\.fill/.test(check.has) ? S.lights : /Hi there/.test(check.has) ? !S.named : /display\.show/.test(check.has) ? true : false
    return check.max === 0 ? !has : has
  }
  return false
}

let controller
function emit(type, detail) {
  controller.event({ type, detail })
  render()
}
function render() {
  bd.src = backdrop()
  drawHot()
  controller.draw()
}

/* ================= A: today's drawer and rail, plus the goal display in the sim ================= */
function A() {
  const flow = DATA.lcx.flow
  const st = { i: 0, open: true, met: flow.map(() => new Set()), compact: size === 'phone', banner: false, just: null, answered: {} }
  const doneObj = (i) => flow[i].type === 'objective' && st.met[i].size === flow[i].goals.length
  const railEl = document.createElement('nav')
  railEl.className = 'a-rail'
  railEl.setAttribute('aria-label', 'Mission 1 steps')
  const drawer = document.createElement('section')
  drawer.className = 'a-drawer'
  drawer.id = 'drawer'
  drawer.setAttribute('aria-label', 'Mission')
  ui.append(drawer, railEl)
  const setOpen = (v) => {
    st.open = v
    render()
    if (v) drawer.querySelector('h1, h2')?.focus?.()
  }
  railEl.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.a === 'tog') return setOpen(!st.open)
    const i = Number(b.dataset.i)
    if (i === st.i && st.open) return setOpen(false)
    st.i = i
    st.banner = false
    setOpen(true)
  })
  drawer.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.a === 'x') setOpen(false)
    if (b.dataset.a === 'next' && st.i < flow.length - 1) { st.i++; st.banner = false; render() }
    if (b.dataset.a === 'back' && st.i > 0) { st.i--; render() }
    if (b.dataset.ans) {
      st.answered[b.dataset.q] = st.answered[b.dataset.q] || new Set()
      st.answered[b.dataset.q].add(b.dataset.ans)
      render()
    }
  })
  drawer.addEventListener('keydown', (e) => e.key === 'Escape' && (setOpen(false), railEl.querySelector('.tog').focus()))
  ui.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]')
    if (!b || drawer.contains(b) || railEl.contains(b)) return
    if (b.dataset.a === 'hud') { st.compact = !st.compact; render() }
    if (b.dataset.a === 'bnext') { st.i = Math.min(st.i + 1, flow.length - 1); st.banner = false; setOpen(true) }
  })
  return {
    event(ev) {
      if (ev.type === 'runs') st.open = false // the drawer gets out of the way of the run
      const item = flow[st.i]
      if (item.type !== 'objective') return
      const was = doneObj(st.i)
      item.goals.forEach((g, k) => {
        if (!st.met[st.i].has(k) && met(g.check, ev)) { st.met[st.i].add(k); st.just = k; announce(`Goal met: ${g.md}`) }
      })
      if (!was && doneObj(st.i)) { st.banner = true; announce(`${t('objective')} ${st.i + 1} ${t('complete')}`) }
    },
    draw() {
      const a = ANC()
      const D = DATA.anchors[size]
      const item = flow[st.i]
      pos(railEl, D.rail)
      railEl.innerHTML = `<button class="tog" data-a="tog" aria-expanded="${st.open}" aria-controls="drawer" aria-label="${st.open ? 'Hide mission' : 'Show mission'}">🧭</button>
        <div class="lbl">${t('mission').replace(' ', '<br>')}</div>
        ${flow.map((f, i) => `<button class="st${st.banner && i === st.i ? ' flash' : ''}" data-i="${i}" data-done="${doneObj(i)}" ${i === st.i ? 'aria-current="step"' : ''} aria-label="Step ${i + 1} of ${flow.length}, ${esc(f.title)}${doneObj(i) ? ', done' : ''}">${f.type === 'quiz' ? '?' : i + 1}</button>`).join('')}`
      pos(drawer, D.pane)
      drawer.dataset.open = st.open
      drawer.inert = !st.open
      let body
      if (item.type === 'objective') {
        body = `<h1 tabindex="-1">${esc(item.title)}</h1>${md(item.instructions)}
          <strong>${t('goals')}</strong><ul class="goals">${item.goals.map((g, k) => `<li class="${st.met[st.i].has(k) ? 'met' : ''}"><span class="box"></span>${md(g.md)}</li>`).join('')}</ul>
          ${doneObj(st.i) && item.complete ? `<div class="concept">${md(item.complete)}</div>` : ''}`
      } else {
        body = `<h1 tabindex="-1">${esc(item.title)}</h1>${item.questions.map((q) => {
          const got = st.answered[q.id] || new Set()
          return `${md(q.q)}<div style="display:grid;gap:6px;margin:6px 0 14px">${q.answers.map((x, n) => `<button class="btn ghost" style="text-align:left;text-decoration:none;border:1.5px solid ${got.has(String(n)) ? (x.correct ? 'var(--green)' : '#c62828') : 'var(--line)'};border-radius:10px;color:inherit" data-q="${q.id}" data-ans="${n}">${md(x.a)}</button>`).join('')}</div>`
        }).join('')}`
      }
      drawer.innerHTML = `<header><span>‹ Missions</span><strong>Python with CodeX</strong><button class="x" data-a="x" aria-label="Close">✕</button></header>
        <div class="body">${body}</div>
        <footer><button class="btn ghost" data-a="back">${t('back')}</button><span>Step ${st.i + 1} of ${flow.length}</span><button class="btn" data-a="next">${t('next')}</button></footer>`
      ui.querySelectorAll('.hud, .banner').forEach((n) => n.remove())
      if (!st.open && item.type === 'objective') {
        const h = document.createElement('div')
        h.className = 'hud' + (st.compact ? ' compact' : '')
        h.setAttribute('role', 'group')
        h.setAttribute('aria-label', `Goals for ${t('objective')} ${st.i + 1}`)
        const c = a.canvas
        h.style.left = c[0] + 8 + 'px'
        h.style.maxWidth = c[2] - 16 + 'px'
        h.style.bottom = D.height - (c[1] + c[3]) + 8 + 'px'
        h.innerHTML = `<div class="t"><span class="n">${st.i + 1}.</span>${esc(item.title)}<span class="n">${st.met[st.i].size}/${item.goals.length}</span><button data-a="hud" aria-expanded="${!st.compact}">${st.compact ? '▸' : '▾'}<span class="sr">${st.compact ? t('show') : t('hide')}</span></button></div>
          <ul class="goals">${item.goals.map((g, k) => `<li class="${st.met[st.i].has(k) ? 'met' : ''}${st.just === k ? ' just' : ''}" title="${esc(g.md)}"><span class="box"></span><span>${md(g.md)}</span></li>`).join('')}</ul>`
        ui.append(h)
      }
      if (st.banner) {
        const b = document.createElement('div')
        b.className = 'banner'
        b.setAttribute('role', 'status')
        const c = a.canvas
        b.style.left = c[0] + c[2] / 2 + 'px'
        b.style.top = c[1] + 10 + 'px'
        b.innerHTML = `<span class="ok">✓</span>${t('objective')} ${st.i + 1} ${t('complete')}<button class="btn" data-a="bnext">${t('next')}</button>`
        ui.append(b)
      }
      st.just = null
    },
  }
}

/* ================= B: a coach card in the sim, no drawer ================= */
function B() {
  const flow = DATA.lcx.flow
  const st = { i: 0, met: flow.map(() => new Set()), sheet: false, q: 0, picked: {} }
  const doneObj = (i) => flow[i].type === 'objective' && st.met[i].size === flow[i].goals.length
  const card = document.createElement('section')
  card.className = 'card'
  card.setAttribute('aria-label', 'Mission coach')
  const sheet = document.createElement('section')
  sheet.className = 'sheet'
  sheet.setAttribute('aria-label', 'All of this objective')
  ui.append(card)
  const cheer = (item) => (item.complete || '').split('\n').find((l) => l.trim())?.replace(/^[#>*\s]+|[*]+/g, '').trim() || 'Done!'
  card.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.a === 'more') { st.sheet = true; render(); sheet.querySelector('h1')?.focus() }
    if (b.dataset.a === 'next') { st.i = Math.min(st.i + 1, flow.length - 1); render(); card.querySelector('h3')?.focus() }
    if (b.dataset.ans) { st.picked[b.dataset.ans] = true; render() }
  })
  sheet.addEventListener('click', (e) => e.target.closest('[data-a="close"]') && ((st.sheet = false), render(), card.querySelector('[data-a="more"]')?.focus()))
  sheet.addEventListener('keydown', (e) => e.key === 'Escape' && ((st.sheet = false), render()))
  return {
    event(ev) {
      const item = flow[st.i]
      if (item.type !== 'objective') return
      item.goals.forEach((g, k) => {
        if (!st.met[st.i].has(k) && met(g.check, ev)) { st.met[st.i].add(k); announce(`Done: ${g.md}`) }
      })
    },
    draw() {
      const a = ANC()
      const c = a.canvas
      const item = flow[st.i]
      const small = c[3] < 200
      const w = small ? a.side[2] - 20 : Math.min(310, c[2] - 20)
      card.style.left = (small ? a.side[0] + 10 : c[0] + 10) + 'px'
      // On a phone the sim is a strip: the card sits under it, over the sim's own controls.
      card.style.top = (small ? c[1] + c[3] + 6 : c[1] + 10) + 'px'
      card.style.width = w + 'px'
      card.style.maxHeight = small ? DATA.anchors[size].height - (c[1] + c[3]) - 12 + 'px' : ''
      card.style.overflow = small ? 'auto' : ''
      const dots = flow.map((f, i) => `<i class="${i < st.i || doneObj(i) ? 'd' : i === st.i ? 'c' : ''}"></i>`).join('')
      const done = doneObj(st.i)
      card.classList.toggle('done', done)
      if (item.type === 'objective') {
        const next = item.goals.findIndex((g, k) => !st.met[st.i].has(k))
        const now = done ? cheer(item) : md(item.goals[next].md).replace(/<\/?div[^>]*>|<\/?p>/g, '')
        card.innerHTML = `<div class="top">${t('mission')} · ${st.i + 1}/${flow.length} <span class="dots" aria-hidden="true">${dots}</span></div>
          <h3 tabindex="-1">${esc(item.title)}</h3>
          <div class="now" aria-live="polite">${now}</div>
          ${item.goals.length > 1 ? `<ul class="goals">${item.goals.map((g, k) => `<li class="${st.met[st.i].has(k) ? 'met' : ''}"><span class="box"></span>${md(g.md)}</li>`).join('')}</ul>` : ''}
          <div class="act"><button class="btn ghost" data-a="more" aria-expanded="${st.sheet}">${t('readMore')}</button>${done ? `<button class="btn" data-a="next">${t('next')}</button>` : ''}</div>`
      } else {
        const q = item.questions[0]
        card.innerHTML = `<div class="top">${t('quiz')} · <span class="dots" aria-hidden="true">${dots}</span></div><h3 tabindex="-1">${esc(item.title)}</h3>${md(q.q)}
          <div class="answers" style="display:grid;gap:5px;margin-top:6px">${q.answers.map((x, n) => `<button class="btn ghost" data-ans="${n}" style="text-align:left;text-decoration:none;border:1.5px solid ${st.picked[n] ? (x.correct ? 'var(--green)' : '#c62828') : 'var(--line)'};border-radius:10px;color:inherit">${md(x.a)}</button>`).join('')}</div>`
      }
      if (st.sheet) {
        ui.append(sheet)
        pos(sheet, a.side)
        sheet.innerHTML = `<div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line)"><strong>${esc(item.title)}</strong><button class="btn ghost" data-a="close" style="margin-left:auto" aria-label="Close">✕</button></div>
          <div class="a-drawer" style="position:static;border:0;box-shadow:none;flex:1;overflow:auto"><div class="body"><h1 tabindex="-1">${esc(item.title)}</h1>${md(item.instructions || item.overview || '')}</div></div>`
      } else sheet.remove()
    },
  }
}

/* ================= C and D: guided steps ================= */
function Guided(bold) {
  const J = DATA.journey
  const ES = lang === 'es' ? DATA.es : null
  const tr = (step, key) => (ES?.steps?.[step.id]?.[key] ?? step[key])
  const st = { i: -1, good: false, more: false, hint: false, wrong: {}, fxShown: false }
  const steps = J.steps
  const strip = document.createElement('div')
  strip.className = 'strip'
  const bubble = document.createElement('section')
  bubble.className = 'bubble'
  bubble.setAttribute('aria-label', 'Guide')
  const ring = document.createElement('div')
  ring.className = 'ring pulse'
  const dim = document.createElement('div')
  dim.className = 'dim'
  ui.append(dim, ring, strip, bubble)
  let fxTimer

  const go = (i) => {
    st.i = i
    st.good = false
    st.more = false
    st.hint = false
    st.wrong = {}
    st.fxShown = false
    if (steps[i]?.point === 'palette-item:pixels.fill(...)' && !S.flyout) S.flyout = true // the step before opened it
    render()
    const s = steps[i]
    if (s) announce(`${t('step', { n: i + 1, m: steps.length })}. ${tr(s, 'say') || tr(s, 'ask')}`)
    bubble.querySelector('button')?.focus({ preventScroll: true })
  }
  bubble.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const a = b.dataset.a
    if (a === 'go') go(0)
    if (a === 'next') go(st.i + 1)
    if (a === 'skip') go(st.i + 1)
    if (a === 'more') { st.more = !st.more; render() }
    if (a === 'hint') { st.hint = true; render() }
    if (a === 'show') { st.fxShown = false; fx.innerHTML = ''; render() }
    if (a === 'restart') location.reload()
    if (b.dataset.ans != null) {
      const s = steps[st.i]
      if (s.answers[b.dataset.ans].correct) { st.good = true; announce(tr(s, 'cheer')) }
      else { st.wrong[b.dataset.ans] = true; announce(t('again')) }
      render()
      bubble.querySelector('[data-a="next"]')?.focus()
    }
  })

  // Where the bubble goes: beside its target, inside the stage, never over the target.
  function place(box) {
    const A = DATA.anchors[size]
    const W = Math.min(270, A.width - 24)
    bubble.style.width = W + 'px'
    const H = bubble.offsetHeight || 140
    const [x, y, w, h] = box
    const cand = [
      ['below', x + w / 2 - W / 2, y + h + 16],
      ['above', x + w / 2 - W / 2, y - H - 16],
      ['right', x + w + 16, y + h / 2 - H / 2],
      ['left', x - W - 16, y + h / 2 - H / 2],
    ]
    const fits = ([, l, t]) => l >= 6 && t >= 50 && l + W <= A.width - 6 && t + H <= A.height - 6
    let [side, l, tp] = cand.find(fits) || cand[0]
    l = Math.max(6, Math.min(l, A.width - W - 6))
    tp = Math.max(50, Math.min(tp, A.height - H - 6))
    bubble.style.left = l + 'px'
    bubble.style.top = tp + 'px'
    const ar = bubble.querySelector('.arrow')
    if (ar) {
      const cx = Math.max(14, Math.min(x + w / 2 - l - 8, W - 30))
      const cy = Math.max(14, Math.min(y + h / 2 - tp - 8, H - 30))
      Object.assign(ar.style, side === 'below' ? { top: '-10px', left: cx + 'px', borderRight: '0', borderBottom: '0' }
        : side === 'above' ? { bottom: '-10px', left: cx + 'px', borderLeft: '0', borderTop: '0' }
        : side === 'right' ? { left: '-10px', top: cy + 'px', borderRight: '0', borderTop: '0' }
        : { right: '-10px', top: cy + 'px', borderLeft: '0', borderBottom: '0' })
    }
  }

  function dimAround(box) {
    const A = DATA.anchors[size]
    const [x, y, w, h] = box
    dim.innerHTML = `<svg width="${A.width}" height="${A.height}" aria-hidden="true"><defs><mask id="m"><rect width="100%" height="100%" fill="#fff"/><rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="12" fill="#000"/></mask></defs><rect width="100%" height="100%" fill="rgba(10,10,20,.35)" mask="url(#m)"/></svg>`
    dim.style.opacity = 1
    clearTimeout(dim._t)
    dim._t = setTimeout(() => (dim.style.opacity = 0), reduce ? 2500 : 1300)
  }

  /* ---- D's effects: all CSS, SVG and the Web Animations API; none needs WebGPU ---- */
  const effects = {
    ghost() {
      const f = anchor('palette-item:x')
      const to = anchor('after:x')
      const slot = document.createElement('div')
      slot.className = 'slot'
      pos(slot, [to[0], to[1], f[2] * 0.9, f[3] - 6])
      fx.append(slot)
      const g = document.createElement('div')
      g.className = 'flyghost fly'
      Object.assign(g.style, ghostStyle(f))
      fx.append(g)
      const hand = document.createElement('div')
      hand.className = 'hand'
      hand.textContent = '👆'
      fx.append(hand)
      if (reduce) { g.style.left = to[0] + 'px'; g.style.top = to[1] + 'px'; g.style.opacity = 0.5; return }
      const dx = to[0] - f[0]
      const dy = to[1] - f[1]
      const path = [
        { transform: 'translate(0,0) scale(1)', opacity: 0, offset: 0 },
        { transform: 'translate(0,0) scale(1.04)', opacity: 0.9, offset: 0.12 },
        { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 40}px) rotate(-3deg)`, opacity: 0.9, offset: 0.55 },
        { transform: `translate(${dx}px,${dy}px)`, opacity: 0.9, offset: 0.85 },
        { transform: `translate(${dx}px,${dy}px)`, opacity: 0, offset: 1 },
      ]
      g.animate(path, { duration: 2600, iterations: Infinity, easing: 'ease-in-out' })
      hand.style.left = f[0] + 30 + 'px'
      hand.style.top = f[1] + f[3] / 2 + 'px'
      hand.animate(path.map((k) => ({ ...k, transform: k.transform.replace(/ scale\([^)]*\)| rotate\([^)]*\)/g, '') })), { duration: 2600, iterations: Infinity, easing: 'ease-in-out' })
    },
    beam(arg) {
      const [from, to] = arg.split(' > ')
      const A = DATA.anchors[size]
      const s = anchor(from)
      const ends = to.startsWith('part') ? leds() : [[anchor(to)[0] + anchor(to)[2] / 2, anchor(to)[1] + anchor(to)[3] / 2]]
      const sx = s[0] + s[2]
      const sy = s[1] + s[3] / 2
      const svg = `<svg class="beam" width="${A.width}" height="${A.height}" style="position:absolute;inset:0" aria-hidden="true">${ends
        .map(([ex, ey]) => `<path d="M${sx},${sy} C${sx + 160},${sy - 120} ${ex - 160},${ey + 60} ${ex},${ey}"/>`).join('')}</svg>`
      fx.insertAdjacentHTML('beforeend', svg)
      if (!reduce) setTimeout(() => fx.querySelector('.beam')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }), 2600)
    },
    zoom() {
      const sc = anchor('screen')
      const c = anchor('sim')
      const L = document.createElement('div')
      L.className = 'lens'
      const small = c[3] < 200
      const d = small ? 96 : 150
      L.style.width = L.style.height = d + 'px'
      L.style.left = Math.max(c[0] + 6, sc[0] - d - 34) + 'px'
      L.style.top = Math.max(c[1] + (small ? 4 : 40), sc[1] - 20) + 'px'
      L.innerHTML = `<div class="lcd"${small ? ' style="font-size:11px;left:14px;right:14px;top:22px;bottom:18px"' : ''}><b>${esc(S.typed)}</b></div>`
      L.setAttribute('role', 'img')
      L.setAttribute('aria-label', `CodeX's screen, magnified: ${S.typed}`)
      fx.append(L)
      const A = DATA.anchors[size]
      const lx = parseFloat(L.style.left) + d
      const ly = parseFloat(L.style.top) + d / 2
      fx.insertAdjacentHTML('beforeend', `<svg width="${A.width}" height="${A.height}" style="position:absolute;inset:0" aria-hidden="true"><line x1="${lx}" y1="${ly}" x2="${sc[0] + 6}" y2="${sc[1] + 10}" stroke="#fff" stroke-width="3" stroke-dasharray="4 5"/><rect x="${sc[0]}" y="${sc[1]}" width="${sc[2]}" height="${sc[3]}" rx="4" fill="none" stroke="#fff" stroke-width="2"/></svg>`)
    },
    pulse() {
      for (const [x, y] of leds()) {
        fx.insertAdjacentHTML('beforeend', `<div class="glow" style="left:${x}px;top:${y}px"></div><div class="wave" style="left:${x}px;top:${y}px"></div><div class="wave" style="left:${x}px;top:${y}px;animation-delay:.7s"></div>`)
      }
    },
    morph() {
      const b = ANC().blocks
      const lh = 20.6
      const y0 = b[1] + 56
      const x0 = b[0] + (size === 'phone' ? 172 : 176)
      const lines = [[6, '◀ show block', 220], [7, '◀ set all neopixels block', 120]]
      for (const [n, label, w] of lines) {
        const y = y0 + (n - 1) * lh - 2
        fx.insertAdjacentHTML('beforeend', `<div class="morph-line" style="left:${x0 - 4}px;top:${y}px;width:${w}px;height:${lh}px;animation-delay:${(n - 6) * 0.35}s"></div>
          <div style="position:absolute;left:${x0 + w + 8}px;top:${y}px;background:var(--gold);border-radius:6px;padding:0 7px;font:800 12px/20px Nunito,sans-serif;animation:pop .3s ${(n - 6) * 0.35 + 0.5}s both">${label}</div>`)
      }
    },
    sweep() {
      const c = anchor('sim')
      fx.insertAdjacentHTML('beforeend', `<div style="position:absolute;left:${c[0]}px;top:${c[1]}px;width:${c[2]}px;height:${c[3]}px;overflow:hidden"><div class="sweep"></div></div>`)
    },
    confetti() {
      if (reduce) return
      const A = DATA.anchors[size]
      const colors = ['#f5c518', '#2e7d32', '#e53935', '#1e88e5', '#8e24aa']
      for (let i = 0; i < 70; i++) {
        fx.insertAdjacentHTML('beforeend', `<i class="confetti" style="left:${Math.random() * A.width}px;background:${colors[i % 5]};animation-delay:${Math.random() * 0.9}s;animation-duration:${1.8 + Math.random() * 1.4}s"></i>`)
      }
    },
  }
  const runFx = (list) => {
    if (!bold) return
    for (const f of list || []) {
      const [name, ...rest] = f.split(' ')
      effects[name]?.(rest.join(' '))
    }
  }
  const WAITING_FX = ['ghost'] // shown while the student works; the rest answer what they did

  return {
    event(ev) {
      const s = steps[st.i]
      if (!s || st.good || !s.do) return
      if (met(s.do, ev)) {
        st.good = true
        dim.style.opacity = 0
        fx.innerHTML = ''
        runFx((s.fx || []).filter((f) => !WAITING_FX.includes(f.split(' ')[0])))
        announce(tr(s, 'cheer') || 'Done')
        setTimeout(() => bubble.querySelector('[data-a="next"]')?.focus({ preventScroll: true }), 30)
      }
    },
    draw() {
      const A = DATA.anchors[size]
      const c = anchor('sim')
      // the strip: where the student is in the mission
      Object.assign(strip.style, { left: c[0] + 'px', top: c[1] + 'px', width: c[2] + 'px' })
      strip.innerHTML = `<span>${esc(ES?.title || J.title)}</span><span class="dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i < st.i || (i === st.i && st.good) ? 'd' : i === st.i ? 'c' : ''}"></i>`).join('')}</span><span>${st.i >= 0 && st.i < steps.length ? `${st.i + 1}/${steps.length}` : ''}</span>`
      strip.setAttribute('aria-label', st.i >= 0 && st.i < steps.length ? t('step', { n: st.i + 1, m: steps.length }) : J.title)
      ui.querySelectorAll('.explain, .centre-card').forEach((n) => n.remove())

      if (st.i < 0 || st.i >= steps.length) {
        // the opening and the finish: a card over the simulator
        ring.style.display = 'none'
        dim.style.opacity = 0
        bubble.style.display = 'none'
        const card = document.createElement('section')
        card.className = 'centre-card'
        const w = Math.min(340, A.width - 30)
        const side = ANC().side
        card.style.width = w + 'px'
        card.style.left = Math.max(10, Math.min(side[0] + side[2] / 2 - w / 2, A.width - w - 10)) + 'px'
        card.style.top = c[1] + (c[3] < 200 ? 10 : 50) + 'px'
        if (st.i < 0) {
          card.innerHTML = `<h2>${esc(ES?.title || J.title)} 👋</h2><p>${esc(ES?.promise || J.promise)}</p><button class="btn" data-a="go">${t('go')}</button>`
          if (!st.fxShown) { st.fxShown = true; fx.innerHTML = ''; runFx(['sweep']) }
        } else {
          const code = J.goal.code.replace("Hi, I'm Sam!", S.typed)
          card.innerHTML = `<h2>🎉 ${t('done')}</h2><p>${md(ES?.complete?.say || J.complete.say)}</p><pre aria-label="${t('yourCode')}">${esc(code)}</pre>${md(ES?.complete?.more || J.complete.more)}<button class="btn" data-a="nm">${t('nextMission')}</button>`
          if (!st.fxShown) { st.fxShown = true; fx.innerHTML = ''; runFx(['confetti']) }
        }
        card.addEventListener('click', (e) => e.target.closest('[data-a="go"]') && go(0))
        ui.append(card)
        if (st.i >= steps.length) card.querySelector('h2').setAttribute('tabindex', '-1')
        return
      }

      const s = steps[st.i]
      bubble.style.display = ''
      // the step bubble
      if (s.ask) {
        ring.style.display = 'none'
        const answers = s.answers.map((x, n) => `<button data-ans="${n}" ${st.wrong[n] ? 'data-wrong' : ''} ${st.good && x.correct ? 'data-right' : ''}>${md(ES?.steps?.[s.id]?.answers?.[n] ?? x.a)}</button>`).join('')
        bubble.className = 'bubble' + (st.good ? ' good' : '')
        bubble.innerHTML = `<div class="n">${t('step', { n: st.i + 1, m: steps.length })}</div>${md(tr(s, 'ask'))}<div class="answers">${answers}</div>
          ${Object.keys(st.wrong).length && !st.good ? `<p role="status" style="margin:6px 0 0;color:#c62828;font-weight:700">${t('again')}</p>` : ''}
          ${st.good ? `<div class="row">${md(tr(s, 'cheer'))}<button class="btn" data-a="next">${t('next')}</button></div>` : ''}`
        const W = Math.min(300, A.width - 24)
        bubble.style.width = W + 'px'
        bubble.style.left = Math.max(8, Math.min(c[0] + c[2] / 2 - W / 2, A.width - W - 8)) + 'px'
        bubble.style.top = c[1] + 40 + 'px'
        return
      }
      const target = anchor(s.point === 'palette-item:pixels.fill(...)' && !S.flyout ? 'palette:Lights' : s.point)
      ring.style.display = st.good ? 'none' : ''
      pos(ring, [target[0] - 5, target[1] - 5, target[2] + 10, target[3] + 10])
      const fresh = bubble.dataset.step !== String(st.i)
      bubble.dataset.step = st.i
      bubble.className = 'bubble' + (st.good ? ' good' : '') + (fresh ? ' in' : '')
      const hints = tr(s, 'hints')
      bubble.innerHTML = `<span class="arrow"></span><div class="n">${st.good ? '✓ ' : ''}${t('step', { n: st.i + 1, m: steps.length })}</div>
        ${st.good ? md(tr(s, 'cheer') || '') : md(tr(s, 'say'))}
        ${st.hint && hints ? `<div class="more">💡 ${md(hints[0])}</div>` : ''}
        <div class="row">
          ${st.good ? `<button class="btn" data-a="next">${t('next')}</button>` : `${bold ? `<button class="btn ghost" data-a="show">${t('showMe')}</button>` : ''}${hints && !st.hint ? `<button class="btn ghost" data-a="hint">${t('hint')}</button>` : ''}${s.skippable ? `<button class="btn ghost" data-a="skip">${t('skip')}</button>` : ''}`}
        </div>`
      place(target)
      if (fresh && !st.good) dimAround(target)
      // waiting effects (D), drawn once per step
      if (!st.good && !st.fxShown) {
        st.fxShown = true
        fx.innerHTML = ''
        if (bold) runFx((s.fx || []).filter((f) => WAITING_FX.includes(f.split(' ')[0])))
        else if (s.fx?.includes('ghost')) {
          // C: the same help, standing still: where the block goes
          const f = anchor('palette-item:x')
          const to = anchor('after:x')
          const slot = document.createElement('div')
          slot.className = 'slot'
          pos(slot, [to[0], to[1], f[2] * 0.9, f[3] - 6])
          fx.append(slot)
        }
      }
      // an explainer beside the sim, over the terminal
      if (s.show && st.good) {
        const ex = document.createElement('aside')
        ex.className = 'explain'
        const side = ANC().side
        const top = c[1] + c[3] + (c[3] < 200 ? 96 : 84)
        Object.assign(ex.style, { left: side[0] + 10 + 'px', top: Math.min(top, A.height - 170) + 'px', width: side[2] - 20 + 'px' })
        const cap = md(ES?.steps?.[s.id]?.caption ?? s.show.caption)
        if (s.show.card === 'compare') {
          ex.innerHTML = `<div class="cmp"><div class="blk"><span style="background:#4aa3df">show “${esc(S.typed)}”</span><span style="background:#e2569b">set all neopixels to red</span></div><div aria-hidden="true">⇄</div><pre>display.show("${esc(S.typed)}")\npixels.fill(RED)</pre></div>${cap}`
        } else {
          ex.innerHTML = `<div style="display:flex;gap:12px;align-items:center"><svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="14" width="36" height="36" rx="6" fill="#fff" stroke="#bbb"/><circle cx="32" cy="32" r="11" fill="#ff3b3b"/><circle cx="32" cy="32" r="18" fill="none" stroke="#ff3b3b" stroke-opacity=".4" stroke-width="4"/></svg><div>${cap}</div></div>`
        }
        ui.append(ex)
      }
    },
    start() {
      go(-1)
    },
  }
}

/* ---------------- chrome and start ---------------- */
function chrome() {
  const sizes = [['chromebook', 'Chromebook 1366×768'], ['ipad', 'iPad 1024×768'], ['phone', 'Phone 390×844']]
  const link = (o) => {
    const p = new URLSearchParams({ size, lang, motion: reduce ? 'reduce' : 'full', ...o })
    return `?${p}`
  }
  $('#chrome').innerHTML = `<strong>${DIR}: ${esc(window.DIRECTION_NAME)}</strong>
    <span class="grp">${['A', 'B', 'C', 'D'].map((d) => `<a href="${encodeURI(window.PROTO_FILES?.[d] || `${d}.html`)}${link({})}" ${d === DIR ? 'aria-current="page"' : ''}>${d}</a>`).join('')}</span>
    <span class="grp" role="group" aria-label="Screen">${sizes.map(([k, l]) => `<a href="${link({ size: k })}" aria-pressed="${k === size}" ${k === size ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</span>
    <span class="grp" role="group" aria-label="Motion"><a href="${link({ motion: 'full' })}" ${!reduce ? 'aria-current="page"' : ''}>Motion</a><a href="${link({ motion: 'reduce' })}" ${reduce ? 'aria-current="page"' : ''}>Reduced</a></span>
    ${DIR >= 'C' ? `<span class="grp" role="group" aria-label="Language"><a href="${link({ lang: 'en' })}" ${lang === 'en' ? 'aria-current="page"' : ''}>EN</a><a href="${link({ lang: 'es' })}" ${lang === 'es' ? 'aria-current="page"' : ''}>ES</a></span>` : ''}
    <span class="sp"></span><a href="${link({})}">Restart</a>`
}

document.documentElement.lang = lang
if (reduce) document.body.classList.add('reduce')
chrome()
fit()
controller = DIR === 'A' ? A() : DIR === 'B' ? B() : Guided(DIR === 'D')
render()
controller.start?.()
window.journeyDebug = { S, act, emit, get controller() { return controller } }
