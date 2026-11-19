/**
 * Stands in for Blockly's Dart, JavaScript, Lua and PHP generators (vite.config.js,
 * resolve.alias). @blockly/field-multilineinput requires them, but gives them
 * its block only when registerFieldMultilineInput() is handed them, and the app
 * makes Python alone, so their code never runs and need not be downloaded.
 */
export const Order = {}
