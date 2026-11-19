import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { flightWanted, fetchedFlight, flightConfig } from './sim/tools/flight-library.mjs'
import { BRAND } from './src/brand.js'

// CodeAIR flight (sim/tools/flight-library.mjs): with SIM_FLIGHT=1 the build
// bundles the flight library fetched into sim/build/flight/, and stops if it
// was not fetched; without, it bundles none of it and CodeAIR is not offered.
const FLIGHT = flightWanted()
const flightLib = FLIGHT ? fetchedFlight() : null
const flight = () => ({
  name: 'sim-flight',
  buildStart() {
    if (FLIGHT && !flightLib) {
      const { url, commit } = flightConfig()
      this.error(`SIM_FLIGHT=1, but CodeAIR's flight library (${url} at ${commit || 'no commit pinned'}) is not fetched: run npm run sim:flight`)
    }
  },
  resolveId(id) { return id === 'virtual:sim-flight' ? '\0virtual:sim-flight' : null },
  load(id) {
    if (id !== '\0virtual:sim-flight') return null
    return `export const FLIGHT = ${FLIGHT}\nexport const files = ${JSON.stringify(flightLib?.files ?? {})}\n`
  },
})

// The site carries code under other licences (THIRD_PARTY_NOTICES.md), so it
// serves the notices at licenses/, and with CodeAIR flight the GPL's text for
// its library. Without it, the notices' flight section (between the
// <!-- flight --> markers) is left out, as the library is.
const licenses = {
  name: 'licenses',
  generateBundle() {
    let notices = fs.readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
    if (FLIGHT) notices = notices.replace('{flight-source}', `, for this build <${flightLib.source.url.replace(/\.git$/, '')}/tree/${flightLib.source.commit}>`)
    else notices = notices.replace(/<!-- flight -->[\s\S]*?<!-- \/flight -->\n*/g, '')
    this.emitFile({ type: 'asset', fileName: 'licenses/THIRD_PARTY_NOTICES.md', source: notices })
    if (FLIGHT) this.emitFile({ type: 'asset', fileName: 'licenses/GPL-2.0.txt', source: flightLib.license })
    this.emitFile({ type: 'asset', fileName: 'licenses/LICENSE.txt', source: fs.readFileSync('LICENSE') })
  },
}

// Which build this is, for About and bug reports: package.json's version, and
// the commit it was built from (CI's GITHUB_SHA, else git, else "local").
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'local'
  }
}

// The pages' titles before the strings load (and for anything that reads the
// HTML alone): %BRAND_NAME% in index.html and boards.html is the product's name.
const brandName = {
  name: 'brand-name',
  transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%BRAND_NAME%', BRAND.name) },
}

// Relative base so the built app can be dropped in any sub-path of an
// HTTPS host (Web Serial requires a secure context; file:// will not work).
export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_BUILD__: JSON.stringify(commit()),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    // The app, and the boards page (several simulated boards at once).
    rollupOptions: { input: { main: 'index.html', boards: 'boards.html' } },
  },
  // The simulator's worker is a module (MicroPython's loader uses top-level await).
  worker: { format: 'es', plugins: () => [flight()] },
  plugins: [
    flight(),
    licenses,
    brandName,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.svg', 'blockly-media/*'],
      workbox: {
        // Everything the app needs is bundled: once loaded, it runs offline,
        // the simulator (its wasm, models and first room) included. The
        // other rooms are fetched when chosen, and kept from then on: a
        // class need not download three rooms it may never visit.
        globPatterns: ['**/*.{js,css,html,svg,png,gif,cur,mp3,woff,woff2,webmanifest,wasm,glb,json,webp}'],
        // Mission packs are fetched when opened, and kept by Learn itself
        // (IndexedDB); only their list comes with the app.
        globIgnores: ['**/sim-assets/env/!(gym)/**', '**/learn/packs/!(index).json'],
        runtimeCaching: [{
          urlPattern: /\/sim-assets\/env\//,
          handler: 'CacheFirst',
          options: { cacheName: 'sim-rooms', expiration: { maxEntries: 32 } },
        }],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // boards.html?boards=codex,codeair (or ?lang=es) is still boards.html,
        // not the app (the navigation fallback). A parameter missing here makes
        // a page it is on the app instead (tests/subpath.mjs).
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^boards$/, /^lang$/],
      },
      manifest: {
        name: BRAND.name,
        short_name: BRAND.shortName,
        description: 'Friendly block coding for Firia Labs CodeBot, CodeX, and CodeAIR.',
        theme_color: '#4EB748',
        background_color: '#FFFDF7',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icons/firia-bot-head.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icons/firia-bot-head.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
