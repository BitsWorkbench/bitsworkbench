# The simulator

A simulated Firia Labs device in the browser: the student's program runs on
MicroPython (WebAssembly) against a model of the device in a room, on
simulated time. Why it is built this way is in [DESIGN.md](DESIGN.md); how a
teacher uses it, in [TEACHERS.md](TEACHERS.md).

## Where things are

| | |
|---|---|
| `src/sim/runtime/engine.js` | MicroPython on simulated time: charging, pacing, pause, step, stop, the REPL |
| `src/sim/runtime/worker.js` | the Web Worker: world and engine together; the page's commands in, frames out |
| `src/sim/runtime/mp/` | the built MicroPython, JSPI (committed; rebuilt by `npm run sim:runtime`) |
| `src/sim/runtime/mp-asyncify/` | the same MicroPython built with Asyncify, for browsers without JSPI (committed; same command) |
| `src/sim/world/` | the world, with no DOM and no renderer: clock, rooms (`environment.js`: boxes, cylinders, raised floors), floor, line courses (`courses.js`), the CodeBot, CodeX and CodeAIR models, CodeX's screen and graphics (`screen.js`, `gfx.js`, its font), CodeAIR's flight controller (`crazyflie.js`), knocks for their sound (`hits.js`), maths and randomness |
| `src/sim/python/common/` | the CircuitPython layer over MicroPython: `board`, `digitalio`, `analogio`, `pwmio`, `busio`, `microcontroller`, `time`, and Adafruit's `neopixel` |
| `src/sim/python/radio/` | the radio module CodeX and CodeAIR share; under it `world/radio.js` (a board's radio), `world/infrared.js` (its infrared, under `python/common/pulseio.py`), `runtime/broadcast-air.js` (between workers and tabs) and `runtime/lockstep.js` (headless groups) |
| `src/sim/python/<device>/` | the device's own Python modules, unchanged, and stand-ins for its C modules; `src/sim/kinds.js` says which folders each device runs, and lists the rooms |
| `src/sim/bridge/` | each device's simulated board: its pins, ADC, PWM and bus chips, over the device's model; what each costs in device time |
| `src/sim/view/` | the pictures: Three.js for the room (`view.js`) with CodeBot, CodeAIR and CodeX in it (`codebot-figure.js`, `codeair-figure.js`, `codex-figure.js`); CodeX stands in the showroom, built in `view.js` |
| `src/sim/sim-device.js` | the simulator as a device, with the USB DeviceManager's face |
| `src/sim/device-switch.js` | the app's one device: the USB board or the simulator |
| `src/sim/sim-panel.js` | the simulator panel, above the terminal: the view and its controls (Pause and Step are the app's run controls) |
| `src/sim/settings-panel.js`, `src/sim/settings.js` | the settings panel (the gear): volume and mute per sound bus, realism, the frame-rate readout; the choices, kept in the browser |
| `src/sim/sound.js` | the sound: four buses (motors, speaker, effects, music), the synthesized knocks, a room's music |
| `src/sim/view/realism.js` | realism's levels and Auto's rule; what each level draws (never the world) |
| `src/sim/headless.js` | run a program in Node, no browser: for tests and the cloud; `runHeadlessGroup` runs several boards at once, radios linked |
| `boards.html`, `src/sim/boards/` | the boards page: several simulated boards, each with its own program, and the radio examples they start with |
| `sim/runtime/` | the MicroPython variant (`variant/`, with the line trace for stepping), the port patch, a one-hunk `py.patch` (a jump back reports its line again) and `build.sh` |
| `sim/tools/` | turn the source GLBs into what the browser and the world load |
| `sim/assets/` | the source models and rooms (CC BY-NC 4.0, see its LICENSE) |

## The device's own Python

The simulator runs each device's own frozen Python modules, unchanged, so a
program meets the same `botcore` (and its bugs and timing) as on the device.
They come from Firia's CircuitPython fork (the boards' firmware):

| Device | Branch | Commit | Path |
|---|---|---|---|
| CodeBot CB3 | `codex` | `4d3064021` (2025-04-04) | `ports/esp32s2/boards/cb3/frozen/general/` |
| CodeX | `codex` | `4d3064021` (2025-04-04) | `ports/esp32s2/boards/codex_mk1/frozen/` |
| CodeAIR | `codeair` | `752129a9f` (2026-11-05) | `ports/espressif/boards/codeair/frozen/` |

Under them is a thin CircuitPython layer over MicroPython (`python/common/`):
only what the device code and students' programs use, nothing more. Under
that, each device's simulated board (`src/sim/bridge/`) answers at the level
the device code drives the hardware: a pin's level, an ADC channel, a PWM
duty and frequency, an I2C register, an SPI write. A device's C modules
get small Python stand-ins beside its modules: `cb3_drivers` on the CB3;
`bitmap`, `canvas`, `tft`, `codex_drivers` (with `funcgen`), `radio` and the
CircuitPython audio modules on CodeX; `crtp`, `codeair_drivers`, `img_utils`,
`stm_fw` and CircuitPython's `espcamera` (sees nothing), `sdcardio` and
`storage` (no card), `supervisor` and `traceback` on CodeAIR. Adafruit's
`neopixel` is replaced by a small equivalent.

CodeAIR's flight controller is not Python: the device's `crtp` module talks
over a UART to an STM32 running Crazyflie firmware. Here `crtp` reaches a
simulated Crazyflie (`world/crazyflie.js`) that decodes the same packets, with
the tables of contents from the device's own `flight_catalog.py`. The MicroPython build stores no docstrings, as the devices'
CircuitPython does not, because Firia's modules test for `__doc__`.

CodeX's font is the one in its firmware, read from its firmware image by
`sim/tools/extract-codex-font.mjs`: Adafruit GFX's classic 5x7 font, under
Adafruit's BSD licence (`THIRD_PARTY_NOTICES.md`).

To update them, copy the files from a newer commit and change the table.
CodeAIR's `cflib` is the exception: it is not in this repository (below).

## Building

```bash
npm run build          # makes the simulator's rooms and models, then the site
npm run sim:assets     # just the rooms and models, into public/sim-assets/
npm run sim:flight     # with SIM_FLIGHT=1: fetch CodeAIR's flight library (below)
npm run sim:runtime    # rebuild MicroPython (needs Emscripten; see sim/runtime/build.sh)
node sim/tools/render-icons.mjs   # redraw the device icons (public/icons/dev-*.png) from the models; after sim:assets
```

The MicroPython build only matters when `sim/runtime/` changes: its output is
committed, so building the site needs no Emscripten. It builds both the JSPI and the
Asyncify MicroPython in one run. Node 24 or later (JSPI); `OCB_SIM_VM=asyncify node
tests/sim.mjs` runs the simulator tests on the Asyncify build, and `OCB_SIM_VM=asyncify node
tests/sim-ui.mjs` the browser's (it takes JSPI away from the page, as Safari and Firefox
lack it).

### CodeAIR flight

CodeAIR flies with its firmware's own `cflib` modules (Firia's port of
Bitcraze's Crazyflie library, under the GPL, version 2 or later). They are not
in this repository: a build with `SIM_FLIGHT=1` fetches them from the
repository and commit that `sim/flight-library.json` names, into
`sim/build/flight/` (ignored), and bundles them into the site with the GPL's
text at `licenses/GPL-2.0.txt` and their section of the third-party notices.

```bash
SIM_FLIGHT=1 npm run build      # fetches, then builds with CodeAIR flight
```

The build stops, saying why, if the fetch fails, if the config pins no commit,
or if `SIM_FLIGHT=1` is set and the library was not fetched. Without the flag
the site carries none of it: the simulator offers CodeBot and CodeX, picking
CodeAIR says flight simulation is coming, and the notices leave cflib out. The
tests follow the build: `tests/sim.mjs` skips its flying tests when nothing
was fetched, and `tests/sim-ui.mjs` and `tests/perf.mjs` check whichever kind
of build they are given.

To change where it comes from, change `url` and `commit` in
`sim/flight-library.json` (a full 40-character commit). The repository must
carry the modules flat in `cflib/` with `__init__.py`, and the licence at
`COPYING`, as the firmware has them; Bitcraze's own library will not run here,
as the firmware's copy is ported to CircuitPython.

### CodeX sound files

A simulated CodeX has the sounds/ folder a CodeX ships with (the names are
`sounds` in `src/sim/kinds.js`; the files come from Firia Labs' labs-demos
repository, `codex/stock_sounds/`). On its drive each is a stand-in naming its
length (`driveFiles()`); the simulated `audiomp3` plays it for that long, so a
program waits as on a CodeX. A name the CodeX does not have is an OSError, as on
the board.

A recording in `sim/assets/codex/sounds/<name>.mp3` is heard. `npm run
sim:assets` copies it into the site (`public/sim-assets/codex/sounds/`); the
build reads its length from its MP3 frames (`sim/tools/codex-sounds.mjs`, the
`virtual:codex-sounds` module); the world reports it in the CodeX's `clips`; and
`src/sim/sound.js` fetches, decodes and plays it on the speaker bus, at the
voice's level and the board's volume, stopping it when the program does. The
service worker precaches them with the rest. A name with no recording plays as
a second of silence. Put a recording there only when Firia Labs may publish it
under `sim/assets/LICENSE` (CC BY-NC 4.0), and name it in that file.

## Testing

```bash
npm run test:sim       # headless programs (tests/sim.mjs), then the simulator in the app (tests/sim-ui.mjs)
```

`tests/sim.mjs` runs real programs against the world in Node, far faster than
real time, and checks timing, driving, walls, sensors, determinism, errors,
stopping, pausing, the REPL and the radio between boards. `tests/sim-ui.mjs`
starts the simulator in the built app in headless Chromium, runs every block's
Python on its device, the starter project with the Run button and the REPL,
flies CodeAIR, and has a CodeX remote on the boards page reach a CodeAIR there
and the app's CodeX in another tab. If Playwright's own browser is
missing, point `OCB_CHROMIUM` at an installed Chromium (every browser test reads it).

CI runs both, in `npm test`, on every pull request and before every deploy
(`.github/workflows/`): about 1.5 minutes here, under 3 with every core
busy. The UI test waits on what the boards do, not on the clock, so a slow
runner only makes it slower. When it fails, its screenshots are kept as the
run's `test-screenshots` artifact.

To run a program yourself, headless:

```js
import { runHeadless } from './src/sim/headless.js'
const r = await runHeadless({ source, env: 'gym', seconds: 10, seed: 1 })
// r.output, r.error, r.trace (pose every 50 ms), r.simSeconds, r.wallMs
```

On a line course (`oval`, `eight`, `gap`, `tee`; `world/courses.js`), the robot
starting on it: `runHeadless({ source, course: 'oval', env: 'gym' })`. The rooms are
`gym`, `classroom`, `cafeteria` and `auditorium` (on its stage), and `empty`, a 4 m
square with nothing in it.

Several boards at once, their radios linked, on one timeline (the same run every time):

```js
import { runHeadlessGroup } from './src/sim/headless.js'
const { results } = await runHeadlessGroup({ seconds: 5, devices: [
  { kind: 'codex', source: remote, inputs: [{ t: 1, fn: (w, d) => d.press(4, true) }] },
  { kind: 'codeair', source: listener },
] })
// results[i] as runHeadless returns
```

## The boards page

`boards.html` (the "📡 More boards" link in the simulator bar, for CodeX and CodeAIR) shows
several simulated boards, each with its own Python, picture and terminal, and examples to
start from (among them CodeAIR's factory program and a CodeX remote that pairs with it by
infrared). Every board runs in its own worker, and their radios and infrared reach each
other, and the app's board in another tab of the same browser. `?boards=codex,codeair` starts with those boards; otherwise
the page remembers its boards and programs in this browser.

## Performance

`npm run perf` (after a build) checks the budget for a low-end school
Chromebook, roughly: the page's CPU throttled 4x and software GL, which is
slower than any real GPU. CI runs it as a report. On a cloud machine (2026-11-19):

| | Budget | CodeBot | CodeAIR |
|---|---|---|---|
| First visit, gzip | 600 KB | 576 KB | 576 KB |
| First visit, to load | 3 s | 1.0 s | 1.0 s |
| Simulator start, gzip | 1,400 KB | 1,292 KB | 1,397 KB |
| Simulator start, to ready | 5 s | 1.7 s | 1.9 s |
| Frames a second in the gym, moving | 20 | 44 | 32 |
| Simulated time per wall second | 0.95 | 1.00 | 1.00 |

The first visit is Blockly, the app and the terminal (the app's script is
336 KB gzip, the terminal's 127 KB). The Python editor (CodeMirror, 104 KB gzip)
loads the first time a program is shown as Python, with a plain text box holding
the program and taking typing until it is in (`src/editor/lazy-editor.js`), and
markdown-it (46 KB gzip, with the mission text's rules) the first time a mission
pack opens (`src/learn/tutorial.js`); `tests/lazy-parts.mjs` checks both, and the
budget. Blockly's Dart, JavaScript, Lua and PHP generators do not load at all
(`src/blocks/no-generator.js`).

What keeps it there:
- The device models are built for it (`sim/tools/build-models.mjs`): plain
  colours share a palette texture (CodeAIR 63 draw calls to 10, CodeBot 25
  to 6), meshes simplified (CodeAIR 85k triangles to 36k, its smallest board
  parts dropped; CodeBot 22k to 12k), textures at most 1024 px.
- The view lowers its resolution, to half at most, when it draws fewer than
  24 frames a second, and raises it again above 50 (`SimView._govern`). It
  stops drawing when nothing has moved for 1.5 s.
- The room's floor map is lossless WebP (118 KB, was a 373 KB PNG).

After the first visit the service worker fetches the rest of the site in
the background, about 2 MB gzip (1.4 MB of it the simulator), so the
simulator works offline after that, in the gymnasium. The other rooms
(0.8 to 1.5 MB each) are fetched only when chosen, and kept from then on.

To check on a real Chromebook: the frame rate and resolution the view
settles at, and the first visit on a school network.

## Safari, iPad and Firefox

Without JSPI the simulator runs the Asyncify build of MicroPython (`sim/DESIGN.md`,
section 1). `tests/sim-engines.mjs` runs it in Playwright's WebKit (Safari's engine, and
every iPad browser's) and Firefox: the build chosen, sleep, `input()`, a button wait, Stop
in a sleep and in `input()`, CodeX's `audio.mp3` waiting out its recording, CodeAIR taking
off and Stop landing it, the sound running after Simulate, WebGL; with `OCB_DEVICE` an
iPad's screen and touch (a tap on the toolbox; a finger dragged on the 3D view, with
`OCB_ENGINES=chromium`). CI runs it.

```bash
xvfb-run -a node tests/sim-engines.mjs                                  # WebKit and Firefox
OCB_ENGINES=webkit OCB_DEVICE='iPad (gen 7) landscape' node tests/sim-engines.mjs
OCB_BENCH=1 xvfb-run -a node tests/sim-engines.mjs                      # with the flat-out benchmarks
```

Measured on a development laptop (2026-11-19; software GL; Chromium's JSPI for comparison):

| | Chromium, JSPI | Chromium, Asyncify | WebKit 26 | Firefox 142 |
|---|---|---|---|---|
| Extra download, first Simulate (gzip) | none | 544 KB | 544 KB | 544 KB |
| First program, Run to output | 40 ms | 137 ms | 101 ms | 87 ms |
| CPU-bound program through the simulator, flat out | 1.0 s | 1.6 s | 3.3 s | 6.9 s |
| The same, MicroPython alone | | 1.1 s | 1.6 s | 5.6 s |
| Busy program, motors on, simulated seconds per wall second | 1.00 | 1.00 | 0.72 to 0.89 | 0.97 |

WebKit keeps up with a busy program alone (1.01) and with a sleeping one with the motors on
(1.01); a busy program with the motors on falls behind, so the world's physics in WebKit's
JavaScript is the cost there, not the Asyncify build alone. The program and the world stay
in step; on a slow device they run slower than real time together. Right after the flat-out
benchmarks the same page measured 0.44 (and a CI runner's WebKit 0.00 to 0.14): something the
flat-out runs leave behind slows WebKit further, not yet found.

What only a real iPad shows (for whoever tests one; Safari on iPadOS 17 or later):
- Simulate, then Run CodeBot's starter project: it drives, at the pace of the clock.
- Real-time pace with the motors on (WebKit on a laptop measured 0.72 to 0.89 of real time):
  run this on CodeBot and time it with a stopwatch from Run to `done`. 30 s is real time;
  60 s is half. Note the iPad's model, and try an older iPad if there is one.

  ```python
  from botcore import *
  import time
  motors.enable(True)
  motors.run(LEFT, 40)
  motors.run(RIGHT, 60)
  t = time.monotonic()
  n = 0
  while time.monotonic() - t < 30:
      n += 1
  motors.run(LEFT, 0)
  motors.run(RIGHT, 0)
  print('done')
  ```
- Sound: CodeBot's motors and a CodeX `audio.mp3` heard after Simulate is tapped; and with
  the ringer switch or silent mode on (Safari then silences web audio).
- Touch: a finger turns the 3D view and two fingers zoom; blocks drag from the toolbox to
  the workspace and snap.
- Three boards on the boards page at once for a few minutes, then back to the app: no
  reload, no "a problem repeatedly occurred" (Safari's memory limit).
- Switch to another app and back while a program runs: it goes on (or is paused) cleanly.
- Offline: after the simulator has run once, turn on Airplane Mode, reload, Simulate.

## Adding a device

1. Its model in `src/sim/world/` (a class with `step(dt)` and `snapshot()`).
2. Its `_sim` module in `src/sim/bridge/`, with the device time each call costs.
3. Its Python modules in `src/sim/python/`, named and shaped as on the device.
4. A figure in `src/sim/view/`, and an entry in `src/sim/devices.js` and
   `src/sim/kinds.js`.
5. Tests in `tests/sim.mjs`.

## Adding a line course

Add it to `COURSES` in `src/sim/world/courses.js`: a name, the mat (a rectangle in
metres around the origin), the tape as polylines, and a spawn on the line
(`spawnAlong` puts the line sensors over the tape). Each room lays it at its own
`courseAt`. The simulator's course picker and `runHeadless({ course })` list it
from there. Add a follower test to `tests/sim.mjs`; the rooms test checks that
every course lies on clear floor in every room.

## Adding a room

Add its GLB to `sim/assets/` (and to its LICENSE), an entry in
`sim/tools/build-env.mjs` (its floor layers, the faces too high to be floor, its
physics impostors, what to leave out, its start and where courses go), a name in
`ROOMS` in `src/sim/kinds.js`, and its build to `sim:assets` in package.json.
CodeSpace's start positions are Babylon's: its z is the glTF z, and its x the
glTF x mirrored. `tests/sim.mjs` then checks its start and courses are on clear
floor; look at it from the simulator before trusting it (an impostor may stand
for something no picture shows).
