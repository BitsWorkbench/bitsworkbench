// CodeX's graphics as its C library keeps them: bitmaps and canvases, a tree
// of canvases under two roots (display, then console above it), composited
// onto the panel. Python's bitmap, canvas and tft modules are thin faces of
// this (python/codex/).
//
// show() follows the firmware's C module (canvas_show); where the device's
// behaviour is not documented (print's wrapping and scrolling) this follows
// the spec's best reading; see sim/DESIGN.md.
import { Screen } from './screen.js'
import { CODEX_6X8 } from './fonts/codex6x8.js'

const FONT = CODEX_6X8

export class Gfx {
  constructor(screen) {
    this.screen = screen
    this.items = []
    this.roots = [-1, -1]
    this.auto = true
    this.dirty = false
    this.updateRequested = false
  }

  create(w, h, isCanvas, x, y, scale) {
    const id = this.items.length
    this.items.push({ bmp: new Screen(w, h), isCanvas: !!isCanvas, x, y, scale: scale || 1, children: [], transparent: -1, col: 0, row: 0 })
    return id
  }

  get(id) {
    const it = this.items[id]
    if (!it) throw new Error('no such bitmap')
    return it
  }

  // A change to bitmap id: the panel needs recompositing if it shows it.
  touched(n) {
    this.dirty = true
    return n
  }

  clear(id) {
    const it = this.get(id)
    it.col = it.row = 0
    return this.touched(it.bmp.fill(it.transparent >= 0 ? it.transparent : 0))
  }

  text(id, text, x, y, c, scale, bg) {
    return this.touched(this.get(id).bmp.drawText(FONT, text, x, y, c, scale, bg < 0 ? null : bg))
  }

  image(id, src, x, y, sx, sy, ex, ey, scale) {
    const dst = this.get(id).bmp, s = this.get(src)
    const b = s.bmp
    ex = ex < 0 ? b.width : Math.min(ex, b.width)
    ey = ey < 0 ? b.height : Math.min(ey, b.height)
    let n = 0
    for (let yy = sy; yy < ey; yy++) {
      for (let xx = sx; xx < ex; xx++) {
        const c = b.getPixel(xx, yy)
        if (c === s.transparent) continue
        n += dst.fillRect(x + (xx - sx) * scale, y + (yy - sy) * scale, scale, scale, c)
      }
    }
    return this.touched(n)
  }

  // display.print: text at a character cursor that wraps, and scrolls the
  // canvas when it runs off the bottom.
  print(id, text, c, cx, cy, scale, bg) {
    const it = this.get(id)
    const b = it.bmp
    const cw = FONT.w * scale, ch = FONT.h * scale
    const cols = Math.max(1, Math.floor(b.width / cw)), rows = Math.max(1, Math.floor(b.height / ch))
    if (cx >= 0) it.col = cx
    if (cy >= 0) it.row = cy
    let n = 0
    for (const chr of text) {
      if (chr === '\n') { it.col = 0; it.row++; continue }
      if (chr === '\r') { it.col = 0; continue }
      if (it.col >= cols) { it.col = 0; it.row++ }
      if (it.row >= rows) {
        const up = (it.row - rows + 1) * ch
        n += b.scrollUp(up, bg < 0 ? 0 : bg)
        it.row = rows - 1
      }
      n += b.drawText(FONT, chr, it.col * cw, it.row * ch, c, scale, bg < 0 ? null : bg)
      it.col++
    }
    return this.touched(n)
  }

  // display.show(str), as the C module draws it (canvas.py clears first when
  // it is a new string): white, from the top left corner, at scale 2, over
  // what is there. Nothing wraps it: the device writes each pixel at
  // x + width * y in the canvas's memory, so text past the right edge
  // comes round on the left, a row lower, and past the last row it ends.
  showText(id, text) {
    const b = this.get(id).bmp
    const W = b.width, end = W * b.height, scale = 2
    let n = 0
    let x0 = 0
    for (const ch of text) {
      const rows = FONT.glyph(ch)
      for (let r = 0; r < FONT.h; r++) {
        for (let col = 0; col < FONT.w; col++) {
          if (!((rows[r] >> (FONT.w - 1 - col)) & 1)) continue
          const at = x0 + col * scale + W * r * scale
          for (let yy = 0; yy < scale; yy++) {
            for (let xx = 0; xx < scale; xx++) {
              const i = at + xx + W * yy
              if (i < end) { b.px[i] = 0xffff; n++ }
            }
          }
        }
      }
      x0 += FONT.w * scale
    }
    return this.touched(n)
  }

  // display.show(image): cleared, then the image from the top left corner,
  // at the largest whole scale that fits, as the C module draws it.
  showImage(id, src) {
    const it = this.get(id)
    const b = it.bmp, s = this.get(src).bmp
    let n = b.fill(it.transparent >= 0 ? it.transparent : 0)
    const scale = Math.max(1, Math.floor(Math.min(b.width / s.width, b.height / s.height)))
    n += this.image(id, src, 0, 0, 0, 0, -1, -1, scale)
    return this.touched(n)
  }

  // Composite the tree onto the panel, if it needs it. Returns whether the
  // panel changed.
  present(force = false) {
    if (!this.dirty && !force) return false
    if (!this.auto && !this.updateRequested && !force) return false
    this.dirty = false
    this.updateRequested = false
    const s = this.screen
    s.px.fill(0)
    for (const r of this.roots) if (r >= 0) this._draw(r, 0, 0, 0, 0, s.width, s.height)
    s.version++
    return true
  }

  _draw(id, ox, oy, cx0, cy0, cx1, cy1) {
    const it = this.items[id]
    if (!it) return
    const b = it.bmp, k = it.scale
    const px0 = ox + it.x, py0 = oy + it.y
    const s = this.screen, W = s.width
    const x0 = Math.max(cx0, px0), y0 = Math.max(cy0, py0)
    const x1 = Math.min(cx1, px0 + b.width * k), y1 = Math.min(cy1, py0 + b.height * k)
    for (let y = y0; y < y1; y++) {
      const by = ((y - py0) / k) | 0
      for (let x = x0; x < x1; x++) {
        const c = b.px[by * b.width + (((x - px0) / k) | 0)]
        if (c !== it.transparent) s.px[y * W + x] = c
      }
    }
    for (const ch of it.children) this._draw(ch, px0, py0, x0, y0, x1, y1)
  }
}
