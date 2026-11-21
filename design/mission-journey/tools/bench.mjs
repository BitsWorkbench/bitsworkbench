/**
 * Measures what direction D's animation costs, and what the browsers offer.
 *
 * 1. Chromium, on the real app with the CodeX simulator rendering: frame times for
 *    the sim alone, the sim with D's CSS/SVG effects on top, and the sim with a second
 *    WebGL canvas drawing particles on top (the "GPU overlay" route), each at CPU
 *    slowdowns of 1x, 4x and 6x (Chrome's own stand-in for a low-end device).
 * 2. Chromium and WebKit (Safari's engine): which of the features D uses exist,
 *    and whether WebGPU gives an adapter.
 * 3. WebKit: frame times of the D prototype page with its effects running.
 *
 *   node bench.mjs [app url]      (needs the dev server for 1)
 * Writes ../bench.json.
 */
import { chromium, webkit } from 'playwright'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.argv[2] || 'http://localhost:5287/'
const exe = process.env.OCB_CHROMIUM || `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`
const out = { when: new Date().toISOString(), chromium: {}, webkit: {} }

/** Frame intervals over `ms`, measured in the page: median, 95th percentile, share over 33 ms. */
const FRAMES = (ms) => new Promise((res) => {
  const t = []
  let last = performance.now()
  const end = last + ms
  const tick = (now) => {
    t.push(now - last)
    last = now
    if (now < end) requestAnimationFrame(tick)
    else {
      t.sort((a, b) => a - b)
      const q = (p) => Math.round(t[Math.floor(p * (t.length - 1))] * 10) / 10
      res({ frames: t.length, fps: Math.round((t.length / ms) * 1000), median: q(0.5), p95: q(0.95), janky: Math.round((t.filter((x) => x > 33.4).length / t.length) * 100) })
    }
  }
  requestAnimationFrame(tick)
})

const FEATURES = async () => {
  const f = {
    webgl2: !!document.createElement('canvas').getContext('webgl2'),
    webgpu: 'gpu' in navigator,
    webgpuAdapter: null,
    waapi: typeof Element.prototype.animate === 'function',
    clipPath: CSS.supports('clip-path', 'inset(0 50% 0 0)'),
    svgMask: CSS.supports('mask', 'url(#m)') || CSS.supports('-webkit-mask', 'url(#m)'),
    reducedMotionQuery: matchMedia('(prefers-reduced-motion: reduce)').media !== 'not all',
    inert: 'inert' in HTMLElement.prototype,
    userAgent: navigator.userAgent,
  }
  if (f.webgpu) {
    try {
      const a = await navigator.gpu.requestAdapter()
      f.webgpuAdapter = a ? (a.info?.vendor || 'yes') : 'none'
    } catch (e) { f.webgpuAdapter = 'error: ' + e.message }
  }
  return f
}

// D's effects, the same CSS the prototype uses, put over the real app's simulator.
const CSS_FX = `
.bfx{position:fixed;pointer-events:none;z-index:9999}
.glow{width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:radial-gradient(circle,rgba(255,60,60,.95) 0,rgba(255,40,40,.5) 35%,rgba(255,0,0,0) 70%)}
.wave{width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:2px solid rgba(255,80,80,.9);animation:wave 1.4s ease-out infinite}
@keyframes wave{to{transform:scale(4.2);opacity:0}}
.beam path{fill:none;stroke:#f5c518;stroke-width:4;stroke-linecap:round;filter:drop-shadow(0 0 4px rgba(245,197,24,.9));stroke-dasharray:10 14;animation:flow .7s linear infinite}
@keyframes flow{to{stroke-dashoffset:-24}}
.fg{width:330px;height:46px;border-radius:8px;background:#e2569b;opacity:.85;filter:drop-shadow(0 6px 10px rgba(0,0,0,.35))}
.cf{width:8px;height:12px;top:-20px;animation:fall 2.4s linear infinite}
@keyframes fall{to{transform:translateY(820px) rotate(720deg)}}`
// The lean set: the same effects with no filters or shadows, only transform and opacity moving.
const CSS_LEAN = CSS_FX.replace(/filter:[^;}]*;?/g, '').replace(/drop-shadow\([^)]*\)/g, '')
function addCssFx(lean) {
  const st = document.createElement('style')
  st.textContent = lean ? window.__CSS_LEAN : window.__CSS_FX
  document.head.append(st)
  const c = document.querySelector('#side-pane canvas').getBoundingClientRect()
  const k = c.height / 379
  const leds = [[106, 130], [117, 114], [265, 115], [281, 131]].map(([x, y]) => [c.left + c.width / 2 + (x - 209.5) * k, c.top + y * k])
  let h = ''
  for (const [x, y] of leds) h += `<div class="bfx glow" style="left:${x}px;top:${y}px"></div><div class="bfx wave" style="left:${x}px;top:${y}px"></div><div class="bfx wave" style="left:${x}px;top:${y}px;animation-delay:.7s"></div>`
  h += `<svg class="bfx beam" style="left:0;top:0" width="${innerWidth}" height="${innerHeight}">${leds.map(([x, y]) => `<path d="M600,450 C760,330 ${x - 160},${y + 60} ${x},${y}"/>`).join('')}</svg>`
  const colors = ['#f5c518', '#2e7d32', '#e53935', '#1e88e5', '#8e24aa']
  for (let i = 0; i < (lean ? 30 : 70); i++) h += `<i class="bfx cf" style="left:${Math.random() * innerWidth}px;background:${colors[i % 5]};animation-delay:${Math.random() * 2}s"></i>`
  h += `<div class="bfx fg" id="fg" style="left:150px;top:180px"></div>`
  document.body.insertAdjacentHTML('beforeend', `<div id="bfx">${h}</div>`)
  document.getElementById('fg').animate([{ transform: 'translate(0,0)' }, { transform: 'translate(260px,240px)' }], { duration: 2600, iterations: Infinity, easing: 'ease-in-out' })
}
// The other route: a second WebGL canvas over the page drawing 400 particles each frame.
function addGlFx() {
  const cv = document.createElement('canvas')
  cv.width = innerWidth
  cv.height = innerHeight
  Object.assign(cv.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: 9999 })
  document.body.append(cv)
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true })
  const vs = `#version 300 es
  in vec2 p; uniform float t; void main(){ float a=float(gl_VertexID)*0.37+t; vec2 q=p+vec2(sin(a)*0.3,cos(a*1.3)*0.3); gl_Position=vec4(q,0,1); gl_PointSize=10.0; }`
  const fs = `#version 300 es
  precision mediump float; out vec4 o; void main(){ vec2 d=gl_PointCoord-0.5; float r=1.0-smoothstep(0.2,0.5,length(d)); o=vec4(1.0,0.3,0.3,1.0)*r; }`
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s }
  const pr = gl.createProgram()
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs))
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(pr)
  gl.useProgram(pr)
  const pts = new Float32Array(800).map(() => Math.random() * 2 - 1)
  const b = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, b)
  gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(pr, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  const ut = gl.getUniformLocation(pr, 't')
  const draw = (t) => { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(ut, t / 1000); gl.drawArrays(gl.POINTS, 0, 400); requestAnimationFrame(draw) }
  requestAnimationFrame(draw)
}

// ---- 1 and 2: Chromium ----
{
  const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] })
  for (const [label, rate] of [['cpu 1x', 1], ['cpu 4x', 4], ['cpu 6x', 6]]) {
    const res = {}
    for (const mode of ['sim alone', 'sim + CSS/SVG effects', 'sim + lean CSS/SVG effects', 'sim + WebGL overlay']) {
      const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
      const cdp = await page.context().newCDPSession(page)
      await page.goto(BASE, { waitUntil: 'networkidle' })
      await page.evaluate(() => {
        localStorage.setItem('opencodebot.welcomed.v1', '1')
        localStorage.setItem('opencodebot.device.v1', 'codex')
      })
      await page.reload({ waitUntil: 'networkidle' })
      await page.waitForFunction(() => !!window.openCodeBot)
      if (!/stop/i.test(await page.innerText('#btn-sim'))) await page.click('#btn-sim')
      await page.waitForTimeout(5000)
      // keep the sim drawing: a slow camera orbit by mouse drag through the run
      await page.evaluate(([a, b]) => ((window.__CSS_FX = a), (window.__CSS_LEAN = b)), [CSS_FX, CSS_LEAN])
      if (mode.includes('CSS')) await page.evaluate(addCssFx, mode.includes('lean'))
      if (mode.includes('WebGL')) await page.evaluate(addGlFx)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate })
      const box = await page.locator('#side-pane canvas').boundingBox()
      await page.mouse.move(box.x + 100, box.y + 200)
      await page.mouse.down()
      const measuring = page.evaluate(FRAMES, 5000)
      for (let i = 0; i < 25; i++) await page.mouse.move(box.x + 100 + i * 8, box.y + 200, { steps: 2 })
      await page.mouse.up()
      res[mode] = await measuring
      await page.close()
    }
    out.chromium[label] = res
    console.log('chromium', label, JSON.stringify(res))
  }
  const page = await browser.newPage()
  await page.goto('about:blank')
  out.chromium.features = await page.evaluate(FEATURES)
  out.chromium.version = browser.version()
  console.log('chromium features', JSON.stringify(out.chromium.features))
  await browser.close()
}

// ---- 2 and 3: WebKit, on the D prototype (self-contained) ----
{
  const browser = await webkit.launch()
  const page = await browser.newPage({ viewport: { width: 1366, height: 812 } })
  await page.goto('about:blank')
  out.webkit.features = await page.evaluate(FEATURES)
  out.webkit.version = browser.version()
  console.log('webkit features', JSON.stringify(out.webkit.features))
  await page.goto(`file://${join(HERE, '../dist/D.html')}?size=chromebook`)
  await page.waitForTimeout(500)
  out.webkit['D page, idle'] = await page.evaluate(FRAMES, 4000)
  // run through to the lights step, where beams, glows and rings are all moving
  const hot = (id) => page.locator(`[data-hot="${id}"]`)
  await page.click('[data-a="go"]')
  await page.click('[data-a="skip"]')
  await hot('run').click()
  await page.click('[data-a="next"]')
  await hot('field').click()
  await page.fill('.input-pop', "Hi, I'm Sam!")
  await page.keyboard.press('Enter')
  await page.click('[data-a="next"]')
  await hot('run').click()
  await page.click('[data-a="next"]')
  await hot('lights').click()
  await page.click('[data-a="next"]')
  out.webkit['D page, block flying'] = await page.evaluate(FRAMES, 4000)
  await hot('item').click()
  await page.click('[data-a="next"]')
  await hot('run').click()
  out.webkit['D page, beams + glows + rings'] = await page.evaluate(FRAMES, 4000)
  console.log('webkit', JSON.stringify(out.webkit))
  await browser.close()
}
writeFileSync(join(HERE, '../bench.json'), JSON.stringify(out, null, 1))
