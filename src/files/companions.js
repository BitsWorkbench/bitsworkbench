/**
 * A program's companion files: the other `.py` files in its folder, which Run
 * puts on the board (or the simulator's drive) first, so that `import safety`
 * finds the student's safety.py, as on CodeSpace.
 *
 * It writes to a real board, so it is careful:
 * - only `.py` files directly in the program's folder, by their own names, at
 *   the top of the board's drive (never into lib/ or a subfolder);
 * - never a name the board needs for itself: main.py (Run's own), boot.py,
 *   code.py, or a module of the board's libraries (botcore.py, codex.py,
 *   colors.py, ...), which a student's file of that name would hide. Those
 *   are refused, by name, and not copied;
 * - a file already copied to this board as it is now is not copied again.
 */

/** Names Run never copies over: the board's own startup files. */
const STARTUP = new Set(['main.py', 'boot.py', 'code.py'])

/**
 * The boards' library modules, by file name: what the simulator carries
 * (src/sim/python), which mirrors what the boards ship.
 */
const LIBRARY = new Set(Object.keys(import.meta.glob('../sim/python/**/*.py')).map((p) => p.split('/').pop()))

/** Whether Run may put a file of this name on a board. */
export function copyable(name) {
  return /^[A-Za-z_]\w*\.py$/.test(name) && !STARTUP.has(name) && !LIBRARY.has(name)
}

/**
 * The companions of the program at `path` in `store`: { files: [{ name, text }],
 * refused: [name] }, the other `.py` files beside it.
 */
export async function companionsOf(store, path) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const own = path.split('/').pop()
  const entries = (await store.list(dir)).filter((e) => e.kind === 'file' && e.name.endsWith('.py') && e.name !== own)
  const files = []
  const refused = []
  for (const e of entries) {
    if (!copyable(e.name)) {
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
