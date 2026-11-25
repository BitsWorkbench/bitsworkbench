/**
 * MicroPython's and CircuitPython's line editors, drawn right when a line is
 * longer than the terminal is wide.
 *
 * The board's line editor (the REPL's arrows, history, backspace) redraws a
 * line in place: back with backspaces for up to four places and with
 * `ESC [ n D` for more, then the new text, then `ESC [ K` to clear what is
 * left of the old. Both sequences stop at the terminal's left edge and act on
 * one row, so a line that wrapped onto a second row was redrawn wrongly when
 * recalled: the prompt overwritten, the old text left on the row below.
 *
 * So the terminal turns each `ESC [ n D` into n backspaces (which, with
 * reverse wraparound on, DECSET 45 in terminal.js, step back up a wrapped
 * line as the editor means them to), and `ESC [ K` into `ESC [ J`, which
 * clears to the end of the screen: the rest of the row and any wrapped rows
 * under it. Whatever else the board sends (colours, bold, other cursor
 * moves) goes through as it is, for xterm.js to draw.
 *
 * Sequences can come split across reads (a serial port hands over what it
 * has), so an unfinished one at the end of a chunk is held for the next.
 */
const ESC = 0x1b
const BRACKET = 0x5b
const MAX_BACK = 4096 // a cursor-back of more than this is passed on as it is

export class LineEdits {
  constructor() {
    this.held = [] // the start of a sequence, held over from the last chunk
  }

  /** A chunk as the board sent it (a string or bytes), as the terminal should draw it (the same kind). */
  push(data) {
    const text = typeof data === 'string'
    const codes = text ? Array.from(data, (c) => c.codePointAt(0)) : data
    const out = []
    let seq = this.held
    this.held = []
    const flush = () => { out.push(...seq); seq = [] }
    for (const c of codes) {
      if (!seq.length) {
        if (c === ESC) seq.push(c)
        else out.push(c)
        continue
      }
      seq.push(c)
      if (seq.length === 2) {
        if (c !== BRACKET) flush()
        continue
      }
      if (c >= 0x30 && c <= 0x39) {
        if (seq.length > 8) flush() // longer than any count it would rewrite
        continue
      }
      // the sequence's final byte
      const digits = String.fromCharCode(...seq.slice(2, -1))
      if (c === 0x44 /* D */) {
        const n = digits ? Number(digits) : 1
        if (n >= 1 && n <= MAX_BACK) { for (let i = 0; i < n; i++) out.push(8); seq = []; continue }
      } else if (c === 0x4b /* K */ && (digits === '' || digits === '0')) {
        out.push(ESC, BRACKET, 0x4a /* J */)
        seq = []
        continue
      }
      flush()
    }
    this.held = seq
    if (!text) return Uint8Array.from(out)
    let s = ''
    for (let i = 0; i < out.length; i += 8192) s += String.fromCodePoint(...out.slice(i, i + 8192))
    return s
  }
}
