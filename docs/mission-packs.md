# Mission packs

A mission pack is an interactive textbook: missions of short objectives, each with
instructions, the code it builds toward, the goals that finish it, hints, and quizzes along
the way. This file is the format; `src/learn/pack.js` reads it and refuses a pack that breaks
it, naming every problem it finds.

The structure follows Firia Labs' CodeSpace curriculum (pack, mission, objective, quiz), with
three changes: every objective can be done in blocks or in Python, and the student can switch
between them at any time; a pack holds no script, since packs arrive as files and from teachers;
and the CodeTrek, the code an objective provides, is a set of chunks the student drags from
the palette into their own program.

## A pack file

One JSON file per pack. Every `id` is unique across the whole pack (missions, objectives,
quizzes and questions together), and progress is kept by these ids, so an id never changes
once a pack is in use.

```json
{
  "format": 1,
  "id": "SAMPLE",
  "title": "Pack title",
  "brief": "One line for the pack's card",
  "overview": "Markdown shown when the pack is opened",
  "complete": "Markdown shown when every mission is done",
  "board": "codebot",
  "avatar": "pack.png",
  "assets": { "pack.png": "data:image/png;base64,..." },
  "missions": []
}
```

| Field | Required | What it is |
|---|---|---|
| `format` | yes | `1`. A pack with a higher number needs a newer OpenCodeBot. |
| `id`, `title`, `brief` | yes | Text. |
| `overview`, `complete` | no | Markdown. |
| `board` | yes | `codebot`, `codex` or `codeair`: the board an objective runs on unless it names its own. The student runs it in the simulator or on a board over USB. |
| `licence` | no | Text: who owns the pack and on what terms it may be shared. Shown, small, under the pack's missions. |
| `avatar` | no | The name of an image in `assets`. |
| `assets` | no | Images the Markdown and avatars use, by name: `data:` URLs of PNG, JPEG, GIF or WebP. A pack is one file, so its pictures travel inside it. |
| `missions` | yes | The missions, in order. |

Any other field is an error, so a misspelt field name is caught rather than ignored.

## Missions

```json
{
  "id": "SAMPLE_Lights",
  "title": "Lights",
  "brief": "One line for the mission's card",
  "overview": "Markdown: what the student will build, and why",
  "complete": "Markdown: well done, and ideas to remix it",
  "avatar": "lights.png",
  "flow": []
}
```

`flow` is the mission's objectives, quizzes and journeys, in order. Each item has `type`, `objective`,
`quiz` or `journey`, and the fields below.

## Objectives

```json
{
  "type": "objective",
  "id": "SAMPLE_Lights_01",
  "title": "Lights On",
  "xp": 5,
  "instructions": "Markdown",
  "code": "from botcore import *\n\nleds.user(0b11110000)\n",
  "solution": "from botcore import *\n\nleds.user(0b11111111)\n",
  "trek": [{ "md": "Turn every light on.", "python": "leds.user(0b11111111)\n" }],
  "goals": [{ "md": "Light all eight user LEDs", "check": { "has": "leds.user(0b11111111)" } }],
  "hints": ["Markdown"],
  "complete": "Markdown: a short cheer, puns welcome"
}
```

| Field | Required | What it is |
|---|---|---|
| `id`, `title` | yes | Text. |
| `xp` | no | Points for finishing it; 5 when left out. |
| `board` | no | The board, when it is not the pack's. |
| `instructions` | yes | Markdown: the concept, then what to do. |
| `code` | no | The program the objective starts from: the student's program from the objective before, plus any scaffolding. Python that parses; a part left for the student is a `pass  # TODO: ...` line. |
| `solution` | no | A program that meets every goal. The answer key: never shown to the student. |
| `trek` | no | The CodeTrek: the chunks this objective adds, in order, each `{ "md", "python" }`. The palette shows them as cards in Python and as block stacks in blocks, `md` as each one's caption. A chunk's `python` parses; its to-dos are `pass  # TODO: ...` lines, which become "to do" blocks. |
| `goals` | yes | What finishes the objective: `{ "md", "check" }` each (below). |
| `hints` | no | Markdown, up to three. |
| `complete` | no | Markdown shown when the goals are met. |
| `blocks` | no | Whether the objective is taught in blocks, `true` or `false`. Left out, OpenCodeBot decides (below). |
| `sim` | no | `{ "room", "course" }`: where the simulated board starts, by the ids in `src/sim/kinds.js` (`ROOMS`) and `src/sim/world/courses.js` (`COURSES`). |

The code is always Python. In blocks mode the student sees the same program as blocks, made by
the round trip, so goals, code and solution are written once.

The student can switch between blocks and Python at any time, mid-objective: the program is the
same, and the text, the CodeTrek and the palette follow the switch. But some Python has no
block (a `def` that returns a value, lists and dicts, f-strings, `try`), and stays a grey Python
block; an objective whose code is mostly grey blocks is Python in disguise. So each objective is
**taught in blocks** or not. Unless its `blocks` field says, OpenCodeBot works it out from the
program the objective builds toward (its `solution`, else its `code`, else its CodeTrek's
chunks): taught in blocks when at most a quarter of its lines, not counting blank lines,
comments and imports, would be grey Python blocks, and not when more are or the code does not
parse. When a student is in blocks on an objective not taught in blocks, the objective says so,
with a button that switches to Python. Blocks stay there for a student who wants them.

While an objective with a `trek` is open, both palettes have a **CodeTrek** category at the
top: each chunk under its caption (the start of its `md`, as plain text), as blocks in blocks
mode and as a card of Python in Python mode. A chunk's imports go in once at the top of the
program, wherever it is dropped; in blocks they are the blocks' own business. A chunk's
`pass  # TODO: ...` lines are "to do" blocks, and stay "to do" blocks through the round trip.
Dragging a chunk in (or clicking its card) is the `trek-used` event.

## Journeys

A journey is a mission's work as small guided steps instead of objectives to read. A coach
points at one thing at a time on the real screen (Run, a palette category, the block to drag,
the text to change, a part of the simulated board), with a sentence or two; the step is met
the moment the student does it, checked as goals are; and the bubble turns green with a cheer
and Next. A strip over the simulator shows where the student is. Starting a journey from the
drawer puts the drawer away; leaving it, or finishing, brings the drawer back at what follows.

```json
{
  "type": "journey",
  "id": "SAMPLE_Lights_J",
  "title": "Lights",
  "promise": "Markdown: what the student will have made",
  "chapters": [
    {
      "id": "SAMPLE_Lights_C1",
      "title": "Say it",
      "code": "from codex import *\n\ndisplay.show(\"Hi there!\")\n",
      "steps": [
        { "id": "SAMPLE_run", "say": "Press **▶ Run**.", "point": "run", "do": { "runs": true }, "cheer": "It ran!" },
        {
          "id": "SAMPLE_add",
          "say": "Drag **set all neopixels** under your **show** block.",
          "point": "palette-item:pixels.fill(...)",
          "palette": "lights",
          "do": { "has": "pixels.fill(...)" }
        },
        { "id": "SAMPLE_ask", "ask": "Which line lights CodeX up?", "answers": [{ "a": "`display.show(...)`" }, { "a": "`pixels.fill(...)`", "correct": true }] }
      ]
    }
  ],
  "solution": "from codex import *\n\ndisplay.show(\"Hi, I'm Sam!\")\npixels.fill(RED)\n",
  "complete": "Markdown: well done"
}
```

| Field | Required | What it is |
|---|---|---|
| `id`, `title` | yes | Text. |
| `promise` | yes | Markdown: shown on the opening card and in the drawer. |
| `chapters` | yes | The steps in chapters, each `{ id, title, code, steps }`. `code` (optional) is the program at the chapter's start, the same in blocks and Python: a student can start a chapter over from it, from the drawer, and the journey begins from the first chapter's. Their own program is never lost: when it differs from `code`, they are asked, and it is kept first as a file beside theirs (`main-saved.py`). |
| `solution` | no | The capstone: the program at the end. The answer key, never shown. |
| `complete` | no | Markdown on the finish card. |
| `xp`, `board`, `sim` | no | As for an objective. |

Each step is either something to do or a question:

| Field | What it is |
|---|---|
| `id` | Unique, like every id in a pack. Progress is kept by it. |
| `say` | Markdown, a sentence or two, with `--Blocks--`/`--Python--` where the modes differ. |
| `point` | Where the coach points: a place (below). Left out, the bubble sits over the simulator. |
| `palette` | For a `palette-item`: its category's id, opened for the student when the step starts. |
| `to` | For a block to drag: where it goes, as a place (`after:display.show(...)`). |
| `do` | What meets the step: any check (above), including two events for journeys: `orbit` (the student turned the simulator's camera) and `palette` (opened a category; `"name"` its id). |
| `ask`, `answers` | Instead of `say`, `point` and `do`: a question in the bubble, as in a quiz. |
| `cheer` | Markdown: a few words when it is met. |
| `hints` | Up to three, Markdown, one at a time on request. |
| `more` | Markdown: more to read, folded. |
| `skippable` | `true`: the student may skip it (any step that needs sight, such as turning the camera). |
| `show` | A card beside the simulator once met: `{ "card": "picture", "asset": "...", "caption": "..." }`, `compare` (the program as Python) or `callout`. |
| `fx` | Effects: `ghost` (while the step waits, the `point` block flies to `to`, with a hand; "Show me" plays it again), and once met `beam <place> > <place>` (a line of light, to each part of a `part:`), `zoom <place>` (a magnifier on the board's screen), `pulse <place>` (each part glows), `morph` (each of the student's blocks lights in turn). Under reduced motion they stand still. |
| `mode` | `blocks` or `python`: a step only that mode plays. |

**Places** name things on screen, never selectors: `run`, `stop`, `step`, `switch` (Blocks or
Python), `sim`, `terminal`; `palette:lights`, a category by its id (`basics`, `screen`,
`lights`, `sound`, `sensors`, `radio`, `move`, `logic`, `loops`, `math`, `text`, `lists`,
`variables`, `functions`, `python`); `palette-item:` and a pattern, the block in the open
category whose code matches; `block:` and a pattern, the student's block whose statement
matches, `field:` its text field and `after:` the place just under it; `part:` and a regular
expression, the simulated board's parts by the names `pick` uses.

A journey plays in the mode the student starts it in. The program is the same in both, but
each step's words and places belong to its mode, so switching mid-journey pauses the coach
until the student switches back.

## Quizzes

```json
{
  "type": "quiz",
  "id": "SAMPLE_Lights_Quiz",
  "title": "Checkpoint",
  "overview": "Markdown",
  "complete": "Markdown",
  "questions": [
    {
      "id": "SAMPLE_Lights_Q1",
      "q": "Markdown: the question",
      "xp": 5,
      "answers": [{ "a": "Markdown" }, { "a": "Markdown", "correct": true }]
    }
  ]
}
```

Every question has at least two answers and at least one correct one. OpenCodeBot shuffles the
answers; with several correct, the student finds them all.

## Markdown

Instructions, goals, hints and the rest are Markdown. On top of plain Markdown:

- **Blocks or Python.** `--Blocks--` ... `--/Blocks--` shows only in blocks mode, and
  `--Python--` ... `--/Python--` only in Python mode. Write the text once, and mark only what
  differs: "drag the block" against "type the line".
- **Sections**, as in CodeSpace: `--Concept--` ... `--/Concept--` sets text apart as a panel.
  The kinds: `Concept` (a new idea), `Caution`, `Peek` (folded until opened), `Remix` (try it
  your own way), `Run` (run the program now), `Debug`, `Touch` (try it on the board),
  `ConsoleData` (read what the program prints) and `CheckTheTrek` (the CodeTrek has the code).
  `--File title={blink.py}/--` asks the student to make a new file of that name.
- **Images**: `![what it shows](name.png)` with a name from `assets`.
- **The app's name**: write `{app}`, never the name itself ("{app} saves your work as you
  go"), here and in any of a pack's words: titles, briefs, CodeTrek captions, quiz answers,
  `index.json`. It shows as the name in `src/brand.js`, so a pack reads right when the name
  changes. Code, solutions and checks keep `{app}` as written (it is Python's, there).
- **No HTML.** HTML in a pack shows as the text it is, and links go only to `http` and
  `https` addresses, opening in a new tab.

## Checks

A goal's `check` says what finishes it, as data. A pack holds no script.

Code checks read the student's program as Python, whichever mode they are in, since the blocks
make Python. A **pattern** is one Python statement or expression:

- Spaces, line breaks, quotes and extra parentheses do not matter, and numbers match by value
  (`1` is `1.0`, `0b11111111` is `255`).
- `...` stands for anything: an argument, an expression or a body. `f(...)` is a call of `f`
  with any arguments.
- A call matches a call with more keyword arguments than the pattern names.
- A body matches when the pattern's statements are in it in that order, with others between
  them or not.
- `if a: ...` matches an `if` with `elif` and `else` branches too.
- An expression matches wherever it is in the program; a statement matches any statement.
- The spellings blocks write match the ones a person types: `sleep(1)` matches
  `time.sleep(1)` in a program that has `import time` (a wait block writes that),
  `from time import sleep` matches `import time`, and `x = x + 1` matches `x += 1` (a
  "change by" block). Not the other way round: a pattern `time.sleep(1)` or `x += 1` asks
  for that spelling.

| Check | Met when |
|---|---|
| `{ "has": "pattern" }` | The program contains code matching the pattern. Add `"min": n` for at least n matches, `"max": n` for at most n (`"max": 0` for none), `"in": "pattern"` to count only matches inside a statement matching that pattern (`"in": "if buttons.was_pressed(0): ..."`). |
| `{ "order": ["pattern", ...] }` | Code matching each pattern appears, each after the one before. |
| `{ "all": [check, ...] }`, `{ "any": [check, ...] }` | Every check, or any one, is met. |
| `{ "prints": "regex" }` | A run prints a line matching the regular expression. |
| `{ "runs": true }` | The program runs to its end, or is stopped, without an error. Add `"seconds": n` for at least n seconds of running. |
| `{ "event": "name" }` | The student does something in OpenCodeBot: `edited` (changes the program), `file-created` (with `"name"`, a new file of that name), `trek-used` (drags a CodeTrek chunk in), `stepped` (steps through the program), `switched` (changes between blocks and Python). |
| `{ "pick": "regex" }` | The student clicks a part of the simulated board whose name matches: the name the board's CAD model gives it, as listed in the built model's `public/sim-assets/models/<model>.parts.json` (made from `sim/assets/` by `sim/tools/build-models.mjs`). These are the names CodeSpace's packs use, such as `Cylinder.015` for CodeBot's wheel encoder or `BTN_A` on CodeX. A click is a press and release in place; a drag that turns the camera is not one. |

A goal once met stays met, and OpenCodeBot keeps which goals each objective has met. Code checks
are checked as the student edits, a moment after they pause.

A regular expression (`prints`, `pick`) must not be able to backtrack without end: the reader
refuses a repeat inside a repeat (`(a+)+`), a repeated choice (`(a|ab)*`) and back-references.
OpenCodeBot also tests each one away from the page on at most 1000 characters, and one that takes
over a tenth of a second never matches from then on.

## A pack in two files

A pack can be split: its first missions in one file and the rest in another, so the first part
can be shared freely. The second file continues the first:

```json
{ "format": 1, "id": "SAMPLE", "continues": "SAMPLE_Lights", "missions": [] }
```

`id` is the pack's own, `continues` the id of the last mission in the first file, and
`missions` the missions after it; `assets` (optional) holds the images its missions use that
the first file does not have. It has no other fields. Opened with the first part, its missions
follow the first part's, its images join the first part's, and progress carries across, since
it is kept by id.

## The packs that come with OpenCodeBot

`public/learn/packs/` holds the packs OpenCodeBot offers in Learn, beside `index.json`, their list:

```json
[{ "id": "PWR", "file": "PWR.json", "title": "Python with Robots", "brief": "One line", "board": "codebot" }]
```

`id`, `title`, `brief` and `board` are the pack's own (a test checks they match). Opening one
fetches it and keeps it in the browser, as a pack opened from a file is kept, so a newer
version on the site replaces the one kept before, progress stays, and it opens offline once it
has been opened online. The app does not download the packs themselves until one is opened.

These are the first missions of Firia Labs' curriculum packs (their samplers). They are made
in a private repository by porting the CodeSpace curriculum, and the rest of each pack is a
second file a school is given.
