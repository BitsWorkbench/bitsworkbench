# BitsWorkbench

**Firia Labs' open-source editor and simulator for CodeBot, CodeX and CodeAIR: blocks and Python.**

(Earlier called OpenCodeBot, the repository's name, and for a while LabBlocks.)

BitsWorkbench lets a teacher plug in a **CodeBot**, **CodeX** or **CodeAIR**, snap
some blocks together, and press Run. No board yet? Press Simulate and the
program runs on a simulated one. No install, no accounts, no setup: just a
web page, and a USB cable when there is a board.

**▶ [Open BitsWorkbench](https://bitsworkbench.org/)**: nothing to
install. Chrome or Edge on a computer or Chromebook.

**BitsWorkbench is in Beta:** an early public release. It works, and it is still
changing; tell us what breaks ([issues](https://github.com/firialabs/opencodebot/issues)).

Everything it makes is real CircuitPython, and the Python is one click away,
in place of the blocks, for the class that is ready to type. Learn has short
examples for each board and the first missions of Firia Labs' courses, free.
Schools already teaching with [CodeSpace](https://firialabs.com) keep it.

> Built with ❤️ for the many brilliant teachers who would like to try computer
> science but do not (yet) want to look at a text editor.

---

## What it does

| | |
|---|---|
| 🔌 **Plug and play** | Detects which board you plugged in and shows only the blocks it can actually run. |
| 🧩 **Friendly blocks** | Chunky, colourful, emoji-labelled blocks for screens, lights, motors, flight, sound, sensors and radio. |
| 🐍 **Real Python** | Every block maps to the documented [Firia Labs API](https://docs.firialabs.com/). The 🧩 Blocks / 🐍 Python switch over the program shows it either way, and the Python is always yours to edit in a real editor (colours, auto-indent, undo, find and replace), with the blocks' palette beside it as Python to drag in. Switch back and your Python becomes blocks again; any Python with no block of its own stays as it is, in a grey Python block, and a grey mark beside the line says so while you type. Save a grey Python block to ⭐ My blocks (right-click it) to use it again in any project; your library stays in this browser. On a small screen, the « button at the palette's foot shrinks both palettes to their colours and emoji (» brings the names back). |
| 💬 **A real terminal** | A full REPL to the device: tab completion, arrow-key history and colour all work, because bytes pass straight through. |
| ✈️ **Works offline** | Once the page has loaded it keeps working with no internet at all. Nothing is uploaded anywhere. |
| 💾 **Nothing to lose** | Every program is a Python `.py` file, even one made of blocks, and it saves itself as you go. Click its name over the program for your files: open another, make files and folders, rename or delete them. Files are kept in this browser, or in Chrome and Edge in a folder on your computer. A file made of blocks opens again just as you left it. Run also puts the other `.py` files in your program's folder on the board (or the simulator), so `import safety` finds your `safety.py`; never a name the board needs itself, such as `boot.py` or a library module. |
| 🧭 **Learn** | The top bar's first button. Two quick starts for each board, then more examples folded beneath: five or six short programs per board, easiest first, each with a goal. Open one and it becomes a new file; the one you had stays. Then mission packs ([the format](docs/mission-packs.md)): open a pack file and it shows a mission at a time, kept in this browser for next time. While a pack is open, a narrow rail at the right edge shows the mission and its steps (green once their goals are met); 🧭 on the rail, or a step, slides the mission out as a drawer over the simulator and terminal, and Run puts it away so the simulator is in view. Made for small screens: Chromebooks and iPads. |

## No device? Simulate one

Press **🎮 Simulate** to run your program on a simulated CodeBot (it drives,
sees lines and walls, lights up and beeps), CodeX (its screen, buttons, lights
and sound; the screen goes full screen for a class, with the arrow keys and A
and B as its buttons) or CodeAIR (it flies; the published site is built with
CodeAIR flight, see [sim/README.md](sim/README.md)), in a gymnasium, a classroom, a
cafeteria or on an auditorium's stage. The terminal is a live Python prompt.
No cable needed: it runs in Chrome or Edge 137 or later, on a computer or
Chromebook (see "Browser support"). For teachers:
[sim/TEACHERS.md](sim/TEACHERS.md). How it works:
[sim/README.md](sim/README.md).

## Supported devices

| Device | Connects over | Blocks for |
|---|---|---|
| **CodeBot CB3** | USB (`544d:cb03`) | driving, LEDs, line sensors, proximity, encoders, sound |
| **CodeX** | USB (`544d:c0de`) | 240×240 screen, neopixels, LEDs, tones and songs, buttons, tilt, light, radio |
| **CodeAIR** | USB (`544d:ca00`) | flight, neopixels, LEDs, beeps, buttons, battery, radio |
| **MicroPython / CircuitPython board** | USB, any serial port | pins (digital out and in, analog in) and a millisecond clock, beside all the general blocks |

The original CodeBot CB2 is recognised but cannot be used: its USB interface is
not one a browser can open.

### A MicroPython / CircuitPython board

Pick **MicroPython / CircuitPython board** for any board with a Python prompt
over USB, such as a Raspberry Pi Pico. Connect then lists every serial port.
The app expects nothing of the board but its REPL: no firmware, files or
modules of ours, and no simulator.

- **Which Python.** The board names itself in its banner (asked for at its
  prompt, or just before the first Run if it was busy with its own program),
  and the Pins blocks write that Python (`src/device/flavor.js`):
  `machine.Pin`, `ADC` and `time.ticks_ms` on MicroPython; `board`,
  `digitalio`, `analogio` and `time.monotonic` on CircuitPython. Before a
  board is connected it is MicroPython, or whatever was set by hand in the
  device menu. Seconds since start and Title Case write
  MicroPython's own forms there too (it has neither `time.monotonic` nor
  `str.title`).
- **Run** sends the program through the raw REPL and runs it there, as
  `mpremote run` does: nothing is written to `main.py` or `code.py`, so the
  board's own program stays, and a CircuitPython drive (read-only to code
  while a computer has it) is no obstacle. Stop is Ctrl-C, and stops the
  sending too if the program is still on its way. The program is not kept on
  the board once it is unplugged. The program's other `.py` files are not
  copied either (the board's files are the student's own: a driver, a
  `config.py`); a toast says so, once.
- **Pins** are typed by the name the board knows them by (`LED`, `GP15`,
  `D5`, `A0`, or a number such as `2` on an ESP32). Each pin is claimed once,
  after the imports: a pin set anywhere in the program is an output, and
  reading it gives back what it was set to (so a toggle works); a pin only
  read is an input, pulled up, so a button wired from it to ground reads off
  while pressed. One pin read both as digital and as analog is claimed twice,
  which CircuitPython refuses.

## Browser support

BitsWorkbench talks to hardware through the
[Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API), so
you need **Chrome, Edge or another Chromium browser on a desktop or
Chromebook**, served over `https://` (or `http://localhost` while developing).
The simulator runs in current Chrome, Edge, Safari (so on an iPad) and Firefox.
Where the browser has WebAssembly's JavaScript Promise Integration (JSPI; Chrome
and Edge 137 and later) it runs on that; elsewhere it fetches a larger build of
the same MicroPython the first time Simulate is pressed (`src/sim/support.js`,
`sim/DESIGN.md` section 1). Safari and Firefox cannot connect to a device. A
browser with WebAssembly turned off (Safari's Lockdown Mode) can still build
blocks and show the Python, and pressing Simulate says why it cannot start.

## Running it yourself

```bash
npm install
npm run dev      # http://localhost:5173
```

To build the static site (it is just files: host it anywhere that serves
HTTPS):

```bash
npm run build    # writes dist/
npm run preview  # serve dist/ locally
```

`npm test` runs every suite in `tests/`, none of which need hardware. Among them:

- **`tests/protocol.mjs`**: the debugger-output filter, and a round-trip of the
  file transfer through a real Python interpreter, byte-comparing what the
  device would have written against the original program.
- **`tests/smoke.mjs`**: builds every block in every toolbox in a headless
  browser and checks each one generates Python.
- **`tests/subpath.mjs`**: serves `dist/` from a sub-path, as a host serving
  several projects does, then pulls the network and reloads, so the "works offline" promise
  cannot quietly break.
- **`tests/new-build.mjs`**: after a deploy, a page still on the build its
  service worker kept can lose the parts it loads late (the simulator's view,
  worker and styles). Only then, when the page is already broken, it saves the
  work and reloads once onto the new build (`src/ui/new-build.js`); a deploy
  alone never reloads a working page. This checks that reload, that the work
  survives it, and that it never repeats within a minute.
- **`tests/privacy.mjs`**: walks the app (the palette, a run, the simulator in
  every room, the boards page) recording every request, from the page, its
  workers and its service worker, and fails on any that goes anywhere but the
  site the app came from. About promises nothing leaves the browser; this
  keeps that true.
- **`tests/examples.mjs`**: opens every starter project from Learn, in
  English and Spanish, checks it is a tidy block program for its board with a
  goal, turns its Python back into blocks without losing a line, and runs its
  Python in the simulator.
- **`tests/round-trip.mjs`**: every block in every board's palette, with
  every choice in its dropdowns, made into Python and turned back into
  blocks, must be the same block making the same Python. Then Python with no
  block, comments, and code that does not parse.
- **`tests/learn-pack.mjs`**: mission packs, with no browser: a good pack
  reads with its defaults, each kind of mistake is named with where it is,
  a pack split into two files joins back into one, and its Markdown renders
  with no HTML, script or outside image getting through.
- **`tests/learn-checks.mjs`**: goal checks, with no browser: Python
  patterns against programs written many ways, counts, scopes and order,
  the checks of what happened, and the regex shapes a pack may not use.
- **`tests/learn-ui.mjs`**: a pack file opens from Learn into the tutorial
  pane; its steps, the blocks/Python text, a quiz, the place kept across a
  reload, a broken pack refused, a pack's second file, and closing the pane.
  Then goals ticking as the student types, runs and switches, staying met
  after a reload, and a slow regex stopped without hanging the page.

### Deploying your own copy

`npm run build` writes `dist/`, a plain static site with a relative base path:
any static host can serve it, from the root of a domain or from a sub-path such
as `/opencodebot/`. Nothing in it needs a server, a database or an account.
Firebase Hosting is one way, and the one Firia uses; GitHub Pages, Netlify,
Cloudflare Pages, S3 or your school's own web server work as well.

Whatever the host, set these, as `firebase.json` does for Firebase
(`tests/hosting.mjs` checks every built file against it):

- **HTTPS.** Web Serial needs a secure context, so `https://` (or
  `http://localhost`) is required; over plain `http://` the page loads but
  never connects to a device.
- **Checked afresh on every visit** (`Cache-Control: no-cache`): `/`,
  `index.html`, `boards.html`, `sw.js`, `registerSW.js`, `workbox-*.js`,
  `manifest.webmanifest` and everything under `learn/`. Cached longer, these
  can leave students on an old build.
- **Kept a year** (`Cache-Control: public, max-age=31536000, immutable`):
  `assets/`, whose file names carry their content's hash.
- **Kept an hour** (`Cache-Control: public, max-age=3600`): `sim-assets/`,
  `blockly-media/`, `icons/` and `licenses/`.
- **`Content-Type: application/wasm`** for `.wasm` files.
- **On every response:** `X-Content-Type-Options: nosniff`, and
  `Referrer-Policy: no-referrer` so no page tells another site where a student
  came from.

With Firebase: make a project with Hosting on (and nothing else, for the
privacy promise), then from a built checkout run
`npx firebase-tools use --add` to pick it (this writes `.firebaserc`, which
git ignores) and `npx firebase-tools deploy --only hosting`.

### How Firia deploys

Firia's copy is at **https://bitsworkbench.org/**, on Firebase Hosting (a
custom domain on the site that also answers at
https://firialabs-open-editor.web.app/). `.github/workflows/deploy.yml` builds, tests and publishes the tested
bundle there on every merge to `main`, and CI gives each pull request from a
branch of this repository a preview address, posted on the pull request and
kept a week. Both run only in `firialabs/opencodebot`, so a fork never tries to
deploy as Firia, and only once the repository has:

1. **The project's id** in the repository variable `FIREBASE_PROJECT_ID`
   (Settings, Secrets and variables, Actions, Variables).
2. **A service account** with the *Firebase Hosting Admin* role, its JSON key
   in the repository secret `FIREBASE_SERVICE_ACCOUNT`. The key lives only
   there, never in a file in the repository.

## How it works

```
src/
  device/      talking to the board
    targets.js         which boards exist, and their USB ids
    serial-link.js     Web Serial: open, read, write, notice unplugs
    repl.js            the raw REPL: send a command, write a file
    console-filter.js  strips the debugger's out-of-band bytes
    device-manager.js  connect → detect → load → run → stop, as events
  blocks/      the blocks and the Python they make
    basics.js, codex.js, codebot.js, codeair.js, radio.js
    toolbox.js         what each board's toolbox contains
    generate.js        assembles imports and setup around the block code
    theme.js           colours and shapes
  workspace/   the Blockly workspace, saving and starter projects
  files/       where a student's files live: store.js (the FileStore seam),
               browser-store.js (this browser's own storage, IndexedDB) and
               local-folder.js (a folder on the computer, File System Access API)
  editor/      the Python editor for typed programs (CodeMirror 6)
    python-editor.js   the editor, behind a small surface the app uses
    snippets.js        each block's Python, for the palette beside the editor
    palette.js         that palette: categories, cards, drag (mouse and touch), click
    snippet-drop.js    where a dragged snippet lands, and the one change that puts it there
  learn/       mission packs (docs/mission-packs.md)
    pack.js            reads a pack file and checks it whole, naming every problem
    markdown.js        a pack's Markdown as HTML, its sections, no HTML of its own
    library.js         the packs kept in this browser, and where the student is in each
    tutorial.js        the tutorial pane: a pack's missions, a step at a time
    checks.js          a goal's check against the program (Python patterns) and what happened
    goals.js           watches the program, runs, output and actions; ticks goals as they are met
    regex.js           a pack's regexes: risky shapes refused, every test time-boxed in a worker
    trek.js            an objective's CodeTrek: captions, and its chunks as Python palette cards
    trek-blocks.js     the CodeTrek category in the block palette, its chunks made into blocks
    rail.js            the mission rail at the right edge: the drawer's button, the mission's steps
    learn.js           packs in the app: opening them, the drawer and rail, reopening after a reload
  ui/          terminal, toasts, dialogs, the file browser and the app shell
  i18n/        every string the app shows, one table per language
```

Running a program does what CodeSpace does: interrupt to a prompt, drop into the
raw REPL, write `main.py` a kilobyte at a time, then soft-reboot so the board
runs it. On boards whose firmware halts at a debug prompt, it then says "go".

## Strings and languages

Every string the app shows is in one table per language, in `src/i18n/`. English
(`en.js`) is the reference: every key is there first.

**Adding a string.** Give it a key in `en.js`, near the strings it sits with, and use
it with `t()`:

```js
import { t } from '../i18n/index.js'
toast({ title: t('saved.title'), detail: t('saved.detail', { file: name }) })
```

- **Placeholders** go in braces (`'Saved {file}.'`), and numbers in them are formatted
  for the language. `{app}` is always the product's name and `{issues}` where to report a
  problem; both live in one place, `src/brand.js`, with the page titles, the installed app's
  name and the banner of the Python the blocks write. Never write the name itself
  (`npm run test:brand` checks), and never rename the `opencodebot.*` storage keys: they hold
  students' work.
- **Counts:** a string that depends on one is `{ one: '…', other: '…' }`, chosen by
  `{count}`. Join a list of names with `listOf()`.
- **HTML:** a key ending in `Html` holds HTML, and its placeholders are escaped.
- **The page's markup:** in `index.html`, mark an element with `data-i18n="key"` for its
  text, `data-i18n-html` for HTML, or `data-i18n-attr="title=key;aria-label=key"` for
  attributes.

**Blocks.** A block's words are in the table too, by its type: `block.<type>.message0`
(and `message1` and on, for a block with more lines) and `block.<type>.tooltip`. Leave
them out of the block's JSON in `src/blocks/`; `defineBlocks` fills them in through
Blockly's message system (`Blockly.Msg`, `%{BKY_...}`), as Blockly's own blocks do.
`%1`, `%2` mark where the block's inputs and fields go; a translation keeps every one
and may reorder them. A dropdown's labels use `msg()`:
`options: [[msg('block.opt.on'), 'True'], [msg('block.opt.off'), 'False']]`. Example
values filled in on palette blocks are `sample.*` keys. Blockly's built-in blocks
(Logic, Loops, Math, Text, Lists, Variables, Functions) use Blockly's own translations,
picked in `src/blocks/locale.js`.

**Adding a language.** Copy `en.js` to `<code>.js` (say `fr.js`), translate the values
and leave the keys, then add it to `TABLES` in `src/i18n/index.js`, and Blockly's own
messages for it (`blockly/msg/fr`) to `src/blocks/locale.js`. A key the new table
leaves out falls back to English, so a partial translation works. The language comes
from `?lang=fr` in the address, then the one picked in the ⋯ menu (saved in the
browser), then the browser's own languages. Changing it reloads the page.

Spanish (`es.js`) is the first: a machine draft that needs a review by a native
speaker who teaches. Corrections are very welcome.

**Checking.** `npm run test:pseudo` runs the app in a pseudo-language, `?lang=en-XA`,
where every string from the table has its letters accented (`⟦Ŕûñ⟧`). Any plain letter
on screen, in a dialog, a menu, a block, a tooltip or a dropdown, is a string that
skipped the table, and the test names it. `tests/i18n.mjs` checks that every key the
code uses is in English, that every block has its words, and that each translation
keeps the English placeholders.

## Contributing

Yes please, especially new blocks. See [CONTRIBUTING.md](CONTRIBUTING.md); adding
a block is about fifteen lines in one file.

## Releases

What changed in each release is in [CHANGELOG.md](CHANGELOG.md); how a release is
made and tagged is in [RELEASING.md](RELEASING.md). The site always serves the
latest `main`; a release is a named, tested point on it. Security problems: see
[SECURITY.md](SECURITY.md).

## Licence

This project uses three kinds of terms:

| What | Terms |
|---|---|
| **Code** (everything not listed below) | MIT. See [LICENSE](LICENSE). |
| **Artwork, 3D models and environments** (the simulator's assets live in `sim/assets/`, with their own `LICENSE`) | [Creative Commons Attribution-NonCommercial 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (CC BY-NC 4.0) |
| **Mission packs**: the curriculum text, code and pictures in `public/learn/packs/` (not `index.json`) | CC BY-NC 4.0, copyright Firia Labs. See that folder's `LICENSE`. |
| **Firia Labs names, logos and the mascot** (including everything in `brand/` and the `firia-bot` icons in `public/icons/`) | Trademarks of Firia Labs. Neither licence above covers them. See [TRADEMARKS.md](TRADEMARKS.md). |
| **Others' code** the repository or the site carries: MicroPython (MIT); and, only in a site built with CodeAIR flight, part of Bitcraze's Crazyflie library as CodeAIR's firmware carries it, fetched at build time and not in the repository (**GPL-2.0-or-later**, not MIT; `sim/README.md`, "CodeAIR flight") | See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The built site serves the notices and licence texts at `licenses/`. |
