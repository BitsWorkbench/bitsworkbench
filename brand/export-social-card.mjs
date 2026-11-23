/**
 * Exports brand/social-card.svg to public/social-card.png, the link preview
 * picture (og:image), at 1200 x 630.
 *
 *   node brand/export-social-card.mjs
 *
 * The card's text is live, set in the brand's system font stack, so the export
 * takes whichever of those fonts the machine has (Arial or its metric twin,
 * Liberation Sans, on Linux). Look at the result before committing it. Set
 * OCB_CHROMIUM to a browser's path to use it instead of Playwright's own
 * Chromium, as the tests do.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
const svg = readFileSync(here('./social-card.svg'), 'utf8')

const browser = await chromium.launch(process.env.OCB_CHROMIUM ? { executablePath: process.env.OCB_CHROMIUM } : {})
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`)
await page.locator('svg').screenshot({ path: here('../public/social-card.png') })
await browser.close()
console.log('wrote public/social-card.png')
