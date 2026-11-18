/**
 * The CodeTrek in the block palette: a category at the top of the rail,
 * shown only while an objective with a CodeTrek is open, whose flyout holds
 * the chunks as blocks, each under its caption. A chunk becomes blocks by
 * the round trip (Python to blocks), so the CodeTrek is written once, in
 * Python. Dragging one out is the `trek-used` goal event.
 */
import * as Blockly from 'blockly/core'
import { CODETREK_ID } from '../blocks/toolbox.js'
import { pythonToBlocks } from '../convert/to-blocks.js'
import { t } from '../i18n/index.js'
import { caption } from './trek.js'

/**
 * Give a BlockWorkspace its CodeTrek category. `used()` runs when a chunk is
 * dragged out. Returns { set(trek) }: the open objective's CodeTrek, or null.
 */
export function installCodeTrek(blockWorkspace, { used }) {
  const workspace = blockWorkspace.workspace
  let trek = null
  let contents = []

  workspace.registerToolboxCategoryCallback('CODETREK', () => contents)

  /** Show the category while there is a CodeTrek; a new board's toolbox starts it hidden again. */
  const showIt = () => {
    const item = workspace.getToolbox()?.getToolboxItemById(CODETREK_ID)
    if (!item || item.isVisible() === !!trek) return
    if (trek) item.show()
    else {
      if (workspace.getToolbox().getSelectedItem() === item) workspace.getToolbox().clearSelection()
      item.hide()
    }
  }
  // Another board: its toolbox, and the chunks made into its blocks.
  let board = blockWorkspace.targetId
  blockWorkspace.addEventListener('change', () => {
    if (blockWorkspace.targetId === board) return
    board = blockWorkspace.targetId
    if (trek) contents = flyoutOf(trek, board)
    showIt()
  })

  // A chunk dragged out is the student's own blocks from then on.
  workspace.addChangeListener((e) => {
    if (e.type !== Blockly.Events.BLOCK_CREATE) return
    for (const id of e.ids || []) {
      const block = workspace.getBlockById(id)
      if (!block?.data?.includes('"trek"')) continue
      block.data = null
      used()
    }
  })

  return {
    set(next) {
      trek = next?.length ? next : null
      board = blockWorkspace.targetId
      contents = trek ? flyoutOf(trek, board) : []
      showIt()
      workspace.refreshToolboxSelection()
    },
  }
}

/** The flyout: each chunk's caption, then its blocks (or a word on why it has none). */
function flyoutOf(trek, targetId) {
  // Every chunk's imports, which go at the top of the student's program: one
  // chunk's `from time import sleep` makes the next one's `sleep(1)` a wait block.
  // (An import in brackets may run over several lines.)
  const imports = trek.flatMap((chunk) => chunk.python.match(/^(from|import)\s[^\n(]*(\([^)]*\))?.*$/gm) || []).join('\n')
  return trek.flatMap((chunk, i) => {
    const label = { kind: 'label', text: caption(chunk.md, i + 1, 'blocks') }
    const stacks = stacksOf(chunk.python, targetId, imports)
    if (!stacks.length) return [label, { kind: 'label', text: t('trek.noBlocks') }]
    return [label, ...stacks.map((s) => ({ kind: 'block', ...s, data: JSON.stringify({ trek: i }) }))]
  })
}

/**
 * A chunk's Python as stacks of blocks for the flyout: what would sit in
 * "when program starts" comes out of it, since the chunk goes into the
 * student's own program; a forever loop and functions stay whole. Imports
 * have no block (the blocks add their own), but say what names mean.
 */
function stacksOf(python, targetId, imports) {
  const r = pythonToBlocks(python.replace(/^(from|import)\s[^\n(]*(\([^)]*\))?.*$/gm, ''), targetId, { imports })
  if (!r.ok) return []
  const names = Object.fromEntries((r.state.variables || []).map((v) => [v.id, v]))
  const stacks = []
  for (const top of r.state.blocks?.blocks || []) {
    const stack = top.type === 'ocb_on_start' ? top.inputs?.DO?.block : top
    if (stack) stacks.push(byName(stack, names))
  }
  return stacks
}

/**
 * A block's state with no place and its variables by name, not id: the
 * flyout and then the student's workspace find or make each by its name.
 */
function byName(state, names) {
  const { x, y, id, ...rest } = state
  const out = { ...rest }
  if (rest.fields) {
    out.fields = Object.fromEntries(
      Object.entries(rest.fields).map(([k, v]) => [k, v && typeof v === 'object' && v.id ? { name: names[v.id]?.name ?? v.name, type: names[v.id]?.type ?? '' } : v]),
    )
  }
  if (rest.inputs) {
    out.inputs = Object.fromEntries(
      Object.entries(rest.inputs).map(([k, v]) => [k, { ...(v.block && { block: byName(v.block, names) }), ...(v.shadow && { shadow: byName(v.shadow, names) }) }]),
    )
  }
  if (rest.next?.block) out.next = { block: byName(rest.next.block, names) }
  return out
}
