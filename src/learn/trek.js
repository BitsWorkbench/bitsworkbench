/**
 * An objective's CodeTrek (docs/mission-packs.md): the chunks of code it
 * provides, each with a caption, to drag from the palette into the program.
 * Here, the parts both palettes share: a chunk's caption as plain text, and
 * the chunks as the Python palette's snippets. The blocks side is
 * trek-blocks.js.
 */

const CAPTION_MAX = 70

/** A chunk's caption: numbered, its Markdown as plain text, one short line. */
export function caption(md, n) {
  const plain = md
    .replace(/--\/?[A-Za-z]+[^\n]*?\/?--/g, ' ') // sections
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links: their words
    .replace(/[*_`#>=]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const short = plain.length > CAPTION_MAX ? `${plain.slice(0, CAPTION_MAX - 1).trimEnd()}…` : plain
  return `${n}. ${short}`
}

/**
 * The chunks as Python palette snippets ({ code, line, name, imports, setup }).
 * A chunk's own import lines become the snippet's imports, which the editor
 * adds once at the top wherever the chunk is dropped.
 */
export function trekSnippets(trek) {
  return trek.map((chunk, i) => {
    const lines = chunk.python.replace(/\s+$/, '').split('\n')
    const imports = lines.filter((l) => /^(from|import)\s/.test(l))
    const code = lines.filter((l) => !/^(from|import)\s/.test(l)).join('\n').replace(/^\n+/, '')
    const name = caption(chunk.md, i + 1)
    // `trek` marks it as the CodeTrek's, for the `trek-used` goal event.
    return code ? { code, line: true, name, imports, setup: [], trek: true } : { code: imports.join('\n'), line: true, name, imports: [], setup: [], trek: true }
  })
}
