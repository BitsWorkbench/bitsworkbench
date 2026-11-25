/**
 * The REPL window. Bytes go straight through in both directions, so tab
 * completion, arrow-key history and colour all behave exactly as they do in
 * a real terminal.
 */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

const THEME = {
  background: '#2c2d31',
  foreground: '#f3f1ea',
  cursor: '#f4d038',
  cursorAccent: '#2c2d31',
  selectionBackground: 'rgba(78, 183, 72, 0.35)',
  black: '#2c2d31',
  red: '#ff7a66',
  green: '#7fd47a',
  yellow: '#f4d038',
  blue: '#7fc4ec',
  magenta: '#e9a0d0',
  cyan: '#6fd7cd',
  white: '#f3f1ea',
  brightBlack: '#94959a', // 4.6:1 on the terminal background
  brightRed: '#ff9b8b',
  brightGreen: '#a4e3a0',
  brightYellow: '#ffe57a',
  brightBlue: '#a7d9f5',
  brightMagenta: '#f3bfe1',
  brightCyan: '#9be6de',
  brightWhite: '#ffffff',
}

export class TerminalPanel {
  /** @param {HTMLElement} host @param {(data: string) => void} onInput */
  constructor(host, onInput) {
    this.term = new Terminal({
      theme: THEME,
      fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      convertEol: false,
      scrollback: 4000,
      allowProposedApi: true,
    })
    this.fit = new FitAddon()
    this.term.loadAddon(this.fit)
    this.term.open(host)
    // Reverse wraparound (DECSET 45): a backspace at the left edge goes back
    // to the end of the line above, when that line wrapped onto this one.
    // MicroPython's and CircuitPython's line editors move back over a line
    // with backspaces; without it, a command longer than the terminal is
    // wide is redrawn wrongly when recalled with the arrows (the prompt
    // overwritten, the old text left behind).
    this.term.write('\x1b[?45h')

    // Everything typed goes to the board verbatim — including Ctrl-C and tab.
    this.term.onData(onInput)
    this.term.onBinary((data) => {
      const bytes = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff
      onInput(bytes)
    })

    this._observer = new ResizeObserver(() => this.resize())
    this._observer.observe(host)
    queueMicrotask(() => this.resize())
  }

  resize() {
    try {
      this.fit.fit()
    } catch {
      // The panel can be hidden (other tab selected) — nothing to fit.
    }
  }

  /** What the board (or the simulator) says, with its line editor's redraws made to fit wrapped lines (line-edits.js). */
  write(data) {
    this._wantEdits()
    this._put(() => this.term.write(this.edits ? this.edits.push(data) : data))
  }

  /** Text from the app itself, drawn as it is. */
  show(text) {
    this._put(() => this.term.write(text))
  }

  /** A friendly line from the app itself, in brand green. */
  say(text) {
    this._put(() => this.term.write(`\r\n\x1b[32m${text}\x1b[0m\r\n`))
  }

  warn(text) {
    this._put(() => this.term.write(`\r\n\x1b[33m${text}\x1b[0m\r\n`))
  }

  // line-edits.js loads with the first thing a board says, not on the first
  // visit (it has a download budget, tests/lazy-parts.mjs): until it is here,
  // what is written waits, in order. If it cannot load (a page left on an old
  // build), the board's words go through as they are.
  _put(draw) {
    if (!this._waiting) return draw()
    this._waiting.push(draw)
  }

  _wantEdits() {
    if (this.edits !== undefined) return
    this.edits = null
    this._waiting = []
    import('./line-edits.js')
      .then(({ LineEdits }) => { this.edits = new LineEdits() }, () => {})
      .finally(() => {
        const waiting = this._waiting
        this._waiting = null
        for (const draw of waiting) draw()
      })
  }

  clear() {
    this.term.clear()
  }

  focus() {
    this.term.focus()
  }
}
