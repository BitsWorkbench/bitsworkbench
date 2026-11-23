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
  name: 'BitsWorkbench',
  /** Under an installed app's icon: keep it to about 12 characters. */
  shortName: 'BitsWorkbench',
  /**
   * Names it was made under before, kept out of the code as this one is
   * (tests/brand.mjs). Python written then starts with a banner naming one;
   * any "Made with <name>" banner is read as the blocks' own
   * (src/convert/to-blocks.js), so a past name need not be listed for that.
   */
  pastNames: ['OpenCodeBot', 'Codacious', 'LabBlocks', 'BotBlocks'],
  /**
   * Where the app is published, with no slash at the end. Link previews need
   * an absolute address for their picture (og:image in index.html).
   */
  site: 'https://bitsworkbench.org',
  /** Where a person reports a problem. */
  issues: 'https://github.com/firialabs/opencodebot/issues',
}
