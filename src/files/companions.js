/**
 * A program's companion files: the other `.py` files in its folder, which Run
 * puts on the board (or the simulator's drive) first, so that `import safety`
 * finds the student's safety.py, as on CodeSpace.
 *
 * It writes to a real board, so it is careful:
 * - only `.py` files directly in the program's folder, by their own names, at
 *   the top of the board's drive (never into lib/ or a subfolder);
 * - never a name the board needs for itself, in any case (the drive is FAT):
 *   main.py (Run's own), boot.py, code.py, or a module the board has
 *   (botcore.py, codex.py, colors.py, time.py, ...), which a student's file of
 *   that name would hide; nor two files whose names differ only by case.
 *   Those are refused, by name, and not copied;
 * - a file already copied to this board as it is now is not copied again.
 *   (The memory is this tab's, cleared when the board or simulator changes: a
 *   file changed on the board from elsewhere is not noticed.)
 *
 * A file once copied stays on the board until removed: Run does not delete
 * anything from a student's board.
 */

/**
 * Names Run never puts on a board, as module names, lowercase (the boards'
 * drives are FAT: `Code.py` is `code.py`). A file at the top of the drive
 * comes before the board's own modules on `sys.path`, so one of these names
 * would hide the real one, or take over the board.
 */
const RESERVED = new Set([
  // The board's own startup files (CircuitPython runs code.py before main.py, which is Run's own).
  'main', 'boot', 'code', 'safemode',
  // Modules the boards ship that the simulator does not carry (firialabs devices API).
  'commander', 'crtpstack', 'high_level_commander', 'motion_commander', 'position_hl_commander',
  'widgets', 'fulltest', 'lis2dh', 'lis2hh', 'mic_check', 'codex_drivers',
  // CircuitPython's and MicroPython's own modules.
  'array', 'binascii', 'board', 'builtins', 'busio', 'collections', 'digitalio', 'errno', 'gc', 'io', 'json',
  'math', 'microcontroller', 'micropython', 'neopixel', 'os', 'random', 're', 'select', 'storage', 'struct',
  'supervisor', 'sys', 'time', 'analogio', 'pwmio', 'audiocore', 'audiobusio', 'audiomp3', 'displayio', 'usb_cdc',
  // Everything the simulator's Python carries for the boards: modules, and packages by their folder.
  ...Object.keys(import.meta.glob('../sim/python/**/*.py')).flatMap((p) => {
    const parts = p.replace(/^\.\.\/sim\/python\/[^/]+\//, '').replace(/\.py$/, '').split('/')
    return [parts[0], parts.at(-1)].map((n) => n.toLowerCase())
  }),
])

const module = (name) => name.replace(/\.py$/i, '').toLowerCase()

/** Whether a file of this name is Python, however its extension is written. */
export const isPython = (name) => /\.py$/i.test(name)

/** Whether Run may put a file of this name on a board. */
export function copyable(name) {
  return /^[A-Za-z_]\w*\.py$/.test(name) && !RESERVED.has(module(name))
}

/**
 * The companions of the program at `path` in `store`: { files: [{ name, text }],
 * refused: [name] }, the other `.py` files beside it.
 */
export async function companionsOf(store, path) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const own = path.split('/').pop()
  const entries = (await store.list(dir)).filter((e) => e.kind === 'file' && isPython(e.name) && e.name !== own)
  // On the board's drive, names differing only by case are one file: both are refused.
  const count = new Map()
  for (const e of [...entries, { name: own }]) count.set(module(e.name), (count.get(module(e.name)) || 0) + 1)
  const files = []
  const refused = []
  for (const e of entries) {
    if (!copyable(e.name) || count.get(module(e.name)) > 1) {
      refused.push(e.name)
      continue
    }
    files.push({ name: e.name, text: await store.read(e.path) })
  }
  return { files, refused }
}

/**
 * What has been copied to which board, so an unchanged file is not copied
 * again: by the board's kind and id, each file's text as copied.
 */
export class CopiedFiles {
  constructor() {
    this.boards = new Map()
  }

  /** The files not on this board as they are now. */
  changed(board, files) {
    const had = this.boards.get(board)
    return files.filter((f) => had?.get(f.name) !== f.text)
  }

  /** These files are now on this board. */
  copied(board, files) {
    if (!this.boards.has(board)) this.boards.set(board, new Map())
    for (const f of files) this.boards.get(board).set(f.name, f.text)
  }

  /** The board may no longer hold what was copied (another board, a new simulator). */
  forget(board) {
    this.boards.delete(board)
  }
}
