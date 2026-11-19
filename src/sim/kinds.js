// Which boards the simulator offers, where each one lives, and which Python
// folders (under src/sim/python/) it runs. Kept apart from the models so the
// page can ask without loading them.
import { t } from '../i18n/index.js'

export const KINDS = {
  codebot: { env: 'gym', view: '3d', python: ['common', 'codebot'] },
  // CodeX is held, not driven: its world is empty, and the view shows it in
  // the showroom (view.js), as CodeSpace's simulator does
  codex: { env: 'empty', room: 'showroom', view: 'codex', python: ['common', 'radio', 'codex'], sounds: ['welcome', 'funk', 'roll', 'africa', 'techstyle', 'shire'] },
  // and the flight library, which only a build with CodeAIR flight carries
  // (sim/tools/flight-library.mjs): without it CodeAIR is not offered
  codeair: { env: 'gym', view: '3d', python: ['common', 'radio', 'codeair'], needsFlight: true },
}

/**
 * The files a board ships with on its own drive, as the simulator has them:
 * { 'sounds/welcome.mp3': text }. CodeX's sound files are stand-ins (the
 * simulator has no recorded sound): each holds how long it plays, and the
 * simulated audiomp3 plays that long in silence. The names are the ones
 * Firia Labs' lessons use; a name a CodeX does not have is missing here too.
 * The lengths are a second each until the real ones are measured.
 */
export function driveFiles(kind) {
  const files = {}
  for (const name of KINDS[kind]?.sounds ?? []) files[`sounds/${name}.mp3`] = 'SIM-MP3 1.0\n'
  return files
}

// The rooms a 3D board can be in (built by sim/tools/build-env.mjs), in the
// picker's order. A room is fetched only when it is chosen.
export const ROOMS = {
  gym: t('room.gym'),
  classroom: t('room.classroom'),
  cafeteria: t('room.cafeteria'),
  auditorium: t('room.auditorium'),
}

// The 3D view's cameras, in the menu's order (view/camera-rig.js).
export const CAMERA_MODES = ['rotate', 'chase', 'universal', 'attached']

// A room's music, where it has a track: room id -> { file, credit }, the file
// under sim-assets/ (its licence in sim/assets/LICENSE and
// THIRD_PARTY_NOTICES.md) and the string key of its credit, which the
// settings panel shows while it plays, looped, on the Music bus. No room has
// one yet: the haunted house rooms will bring theirs, e.g.
//   attic: { file: 'music/attic.mp3', credit: 'music.creditKidFears' }
export const MUSIC = {}
