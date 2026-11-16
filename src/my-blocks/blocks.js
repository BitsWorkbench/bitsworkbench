/**
 * "My blocks" on the canvas: a palette category that fills itself from the
 * student's library (like Variables), and the block menu's "Save to My
 * blocks" on a grey Python block, with "Rename" and "Remove from My blocks"
 * on a block in the category.
 */
import * as Blockly from 'blockly/core'
import { t } from '../i18n/index.js'

/** The toolbox's name for the category (toolbox.js). */
export const MY_BLOCKS = 'MY_BLOCKS'

const GREY = new Set(['ocb_python', 'ocb_python_value'])

/** The library the menus work on (one workspace per page). */
let library = null
let onSaved = () => {}

/** The id of the saved block a palette block shows, or null. */
function savedId(block) {
  if (!block?.isInFlyout) return null
  try {
    return JSON.parse(block.data || 'null')?.myBlock ?? null
  } catch {
    return null
  }
}

/** The library entry for a grey block's code, if saved. */
function savedFor(block) {
  const code = block.getFieldValue('CODE')
  const value = block.type === 'ocb_python_value'
  return library?.list().find((i) => i.code === code && !!i.value === value) || null
}

/** The category's contents: each saved block under its name, or a hint. */
function contents() {
  const items = library?.list() || []
  if (!items.length) return [{ kind: 'label', text: t('myBlocks.empty1') }, { kind: 'label', text: t('myBlocks.empty2') }]
  return items.flatMap((i) => [
    { kind: 'label', text: i.name },
    {
      kind: 'block',
      type: i.value ? 'ocb_python_value' : 'ocb_python',
      fields: { CODE: i.code },
      data: JSON.stringify({ myBlock: i.id }),
    },
  ])
}

let registered = false
function registerMenus() {
  if (registered) return
  registered = true
  const { registry, ScopeType } = Blockly.ContextMenuRegistry
  registry.register({
    id: 'myBlocksSave',
    scopeType: ScopeType.BLOCK,
    weight: 8,
    displayText: () => t('myBlocks.save'),
    preconditionFn: ({ block }) => {
      if (!library || !block || block.isInFlyout || !GREY.has(block.type)) return 'hidden'
      return savedFor(block) ? 'disabled' : 'enabled'
    },
    callback: ({ block }) => {
      const item = library.add({ code: block.getFieldValue('CODE'), value: block.type === 'ocb_python_value' })
      onSaved(item)
    },
  })
  registry.register({
    id: 'myBlocksRename',
    scopeType: ScopeType.BLOCK,
    weight: 8,
    displayText: () => t('myBlocks.rename'),
    preconditionFn: ({ block }) => (library && savedId(block) ? 'enabled' : 'hidden'),
    callback: ({ block }) => {
      const id = savedId(block)
      const item = library.list().find((i) => i.id === id)
      if (!item) return
      Blockly.dialog.prompt(t('myBlocks.namePrompt'), item.name, (name) => {
        if (name) library.rename(id, name)
      })
    },
  })
  registry.register({
    id: 'myBlocksRemove',
    scopeType: ScopeType.BLOCK,
    weight: 9,
    displayText: () => t('myBlocks.remove'),
    preconditionFn: ({ block }) => (library && savedId(block) ? 'enabled' : 'hidden'),
    callback: ({ block }) => library.remove(savedId(block)),
  })
}

/**
 * Give a workspace its "My blocks": the category from `store`, and the
 * menus. `saved(item)` runs after a block is saved (to say so).
 */
export function installMyBlocks(workspace, store, { saved } = {}) {
  library = store
  onSaved = saved || (() => {})
  registerMenus()
  workspace.registerToolboxCategoryCallback(MY_BLOCKS, contents)
  // The open category shows the change at once.
  store.addEventListener('change', () => workspace.refreshToolboxSelection())
  // A block taken from the category is an ordinary grey block: it does not
  // carry the library's id into the project.
  workspace.addChangeListener((e) => {
    if (e.type !== Blockly.Events.BLOCK_CREATE) return
    for (const id of e.ids || []) {
      const block = workspace.getBlockById(id)
      if (block?.data?.includes('"myBlock"')) block.data = null
    }
  })
}
