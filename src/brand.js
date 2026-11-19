/**
 * The product's name and addresses, in one place.
 *
 * Every name a person sees comes from here: the page titles, the installed
 * app's name, the {app} in every string (src/i18n/index.js), and the banner
 * at the top of the Python the blocks write. Renaming the product is a change
 * to this file (and the docs).
 *
 * Not from here, on purpose: the `opencodebot.*` storage keys and database
 * names that hold students' programs, libraries and settings. They are never
 * shown, and renaming them would lose everyone's saved work.
 */
export const BRAND = {
  /** The product's name, as a person reads it. */
  name: 'Codacious',
  /** Under an installed app's icon: keep it to about 12 characters. */
  shortName: 'Codacious',
  /**
   * Names it was made under before. Python written then still starts with a
   * banner naming one of them, which is read as the blocks' own, not the
   * student's comment.
   */
  pastNames: ['LabBlocks', 'OpenCodeBot'],
  /** Where a person reports a problem. */
  issues: 'https://github.com/firialabs/opencodebot/issues',
}
