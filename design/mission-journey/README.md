# Mission journey: design prototypes

A design study of how a student is led through a mission, played on CodeX mission 1
("Welcome"). Nothing here is part of the app: no file under `src/` changes, and nothing
here is built or shipped with it.

Four directions, one engine (`proto/journey.js`):

| | Direction | What it is |
|---|---|---|
| A | Parity plus | Today's drawer and rail, plus the current objective's goals in the simulator and an "objective complete" banner. |
| B | Coach card | No drawer by default: a card in the simulator with one instruction (the first goal not yet met); the full text on request. |
| C | Guided steps | The mission as small steps: a ring and a bubble point at one thing to do, checked the moment it is done. |
| D | Living sim | C, with motion that answers the student: a block flying to its slot, a beam from a block to the part it drives, a lens on the screen, glowing NeoPixels. CSS, SVG and the Web Animations API only. |

The prototypes run over screenshots of the real app, with real buttons where its controls
are. A and B play the mission's objectives from `public/learn/packs/LCX.json`; C and D play
the same mission written as steps, in `proto/welcome.journey.json` (a translation beside it,
`welcome.es.json`, keyed by step id).

## A mission as steps (format 2, a proposal)

A step names a place on screen (never a selector), what finishes it (the same checks as
[mission-packs.md](../../docs/mission-packs.md)), and the words:

```json
{
  "id": "add",
  "say": "Drag **set all neopixels** under your **show** block.",
  "point": "palette-item:pixels.fill(...)",
  "to": "after:display.show(...)",
  "do": { "has": "pixels.fill(...)" },
  "fx": ["ghost"],
  "hints": ["Press and hold the pink block, then let go just under the blue one."],
  "cheer": "Snap!"
}
```

Places: `run`, `switch`, `step`, `sim`, `terminal`, `palette:<group>`, `palette-item:<pattern>`,
`block:<pattern>`, `field:<pattern>`, `part:<regex>` (sim parts by the names `pick` uses),
`after:<pattern>`. Two new events: `orbit` (the student turned the simulator) and `palette`
(opened a group). Effects: `ghost`, `beam <from> > <to>`, `zoom screen`, `pulse part:<regex>`,
`morph`. Also `show` (an explainer card: `picture`, `compare`, `callout`), `ask`/`answers`
(an inline question), `more`, `skippable`.

## Tools

From the repository root, with a dev server on port 5287 (`npx vite --port 5287`) and the
simulator's assets built (`npm run sim:assets`):

| Command | Does |
|---|---|
| `node design/mission-journey/tools/capture.mjs` | Screenshots of the real app in each state the prototypes show, at Chromebook, iPad and phone sizes, and the boxes of the controls (`proto/backdrops/`, `proto/anchors.json`). |
| `node design/mission-journey/tools/build.mjs` | The four prototypes as self-contained pages in `dist/`. |
| `node design/mission-journey/tools/walk.mjs` | Plays each prototype through the mission at three sizes (by mouse, touch and keyboard, and D in Spanish with reduced motion), checks where it ends, and takes screenshots into `shots/`. |
| `node design/mission-journey/tools/bench.mjs` | Frame times of the simulator alone, with D's effects, with lean effects and with a second WebGL canvas, at CPU slowdowns, plus which features Chromium and WebKit offer (`bench.json`). |
| `node design/mission-journey/tools/words.mjs` | Words shown per objective today and per step as a journey (`words.json`). |

The tools use Playwright's Chromium (set `OCB_CHROMIUM` to use another) and WebKit.
