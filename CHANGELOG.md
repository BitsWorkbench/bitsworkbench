# Changelog

What changed for teachers and students, newest first. Each release is tagged
`v<version>` (see [RELEASING.md](RELEASING.md)); versions follow
[Semantic Versioning](https://semver.org/). A pull request a person would notice
adds a line under **Unreleased**.

## Unreleased

The first public release, planned for December 1, 2026. Everything it holds:

### Editor
- Blocks for CodeBot, CodeX and CodeAIR, each in its category's colour, with dark
  text for contrast, matching the boards' documented Python.
- Blocks and Python, one click apart. Python turns back into blocks, and any
  Python with no block of its own stays as it is, in a grey Python block, with a
  quiet mark beside its line.
- A real Python editor (CodeMirror): colours, auto-indent, undo, find and replace,
  with the blocks' palette beside it as Python to drag in or click.
- My blocks: save a grey Python block to your own palette category.
- Files: programs are `.py` files that save themselves, kept in the browser or, in
  Chrome and Edge, in a folder on the computer. Make, rename and delete files and
  folders; Run also puts a program's other `.py` files on the board, so it can
  import them.
- Waits are in seconds; `change x by 1` writes `x += 1`.

### Boards and the simulator
- Plug in a board over USB: it is detected, and only its blocks are offered. A
  full terminal to the board.
- Simulate a CodeBot, CodeX or CodeAIR with no board, in a gymnasium, a
  classroom, a cafeteria or an auditorium: driving, line and proximity sensors,
  the CodeX screen, buttons, tilt and sound, CodeAIR flight and its rotor whine,
  radio between simulated boards. Run, Stop, Pause and Step, `input()`, and
  clicking a board's buttons.
- A simulated CodeX plays its built-in sound files (`audio.mp3("sounds/welcome")`
  and the rest of its sounds/ folder), and the program waits while one plays.
- One board at a time: picking another never loses the program.

### Learn
- Short examples for each board, easiest first, two of them as quick starts.
- Mission packs open in a tutorial pane: steps, goals that tick as they are met,
  quizzes, CodeTrek in the palette, and each step taught in blocks or in Python.
- The first six missions of four Firia Labs courses, free: Python Level 1 with
  CodeBot, Python with Robots, Python with CodeX, and Fly with Python.

### Foundations
- Accessibility: keyboard paths through the app, labelled controls, 4.5:1
  contrast, and an automated WCAG 2.1 AA check on every change.
- Languages: English and Spanish (machine-drafted), and a test language that shows
  any string left untranslated.
- Privacy: no accounts, no ads, no tracking; nothing about a student or their
  work leaves the browser, and a test holds it to that.
- Works offline once loaded; a page left open across an update moves onto the new
  build without losing work.
