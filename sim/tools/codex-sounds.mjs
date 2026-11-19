// The CodeX's own sound files, as the simulator has them: which of the names
// a CodeX ships with have a recording here, and how long each plays.
//
// The recordings, where Firia Labs may publish them, are in
// sim/assets/codex/sounds/<name>.mp3 (under sim/assets/LICENSE). Run as a
// script (npm run sim:assets runs it), this copies them to
// public/sim-assets/codex/sounds/, where the site serves them and
// src/sim/sound.js plays them on the speaker bus. A name with no recording
// plays as a second of silence: the program still waits and goes on.
//
//   node sim/tools/codex-sounds.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SOUNDS_DIR = path.join(ROOT, 'sim/assets/codex/sounds')
const SERVED = path.join(ROOT, 'public/sim-assets/codex/sounds')

/** { name: { seconds, audio: true } } for each recording in `dir`. */
export function recordedSounds(dir = SOUNDS_DIR) {
  if (!fs.existsSync(dir)) return {}
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4))
  return Object.fromEntries(Object.entries(codexSounds(names, dir)).filter(([, s]) => s.audio))
}

/** { name: { seconds, audio } } for each name, from the files in `dir`. */
export function codexSounds(names, dir = SOUNDS_DIR) {
  const table = {}
  for (const name of names) {
    const file = path.join(dir, `${name}.mp3`)
    const seconds = fs.existsSync(file) ? mp3Seconds(fs.readFileSync(file)) : 0
    table[name] = seconds > 0 ? { seconds: Math.round(seconds * 1000) / 1000, audio: true } : { seconds: 1, audio: false }
  }
  return table
}

// MPEG audio Layer III: bitrates (kbit/s) by index, for MPEG-1 and for MPEG-2/2.5.
const RATE_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const RATE_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

/**
 * How long an MP3 plays, in seconds: its frames' samples over their sample
 * rate, walking the frame headers (an ID3v2 tag in front is skipped). 0 when
 * it holds no Layer III frame.
 */
export function mp3Seconds(buf) {
  let i = 0
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    i = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f))
  }
  let seconds = 0
  while (i + 4 <= buf.length) {
    const b1 = buf[i + 1], b2 = buf[i + 2]
    const version = (b1 >> 3) & 3          // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layer = (b1 >> 1) & 3            // 1: Layer III
    const rateIndex = b2 >> 4, srIndex = (b2 >> 2) & 3
    if (buf[i] !== 0xff || (b1 & 0xe0) !== 0xe0 || version === 1 || layer !== 1 || rateIndex === 0 || rateIndex === 15 || srIndex === 3) {
      i++                                  // not a frame here: look on
      continue
    }
    const sampleRate = SAMPLE_RATES[version][srIndex]
    const kbps = (version === 3 ? RATE_V1 : RATE_V2)[rateIndex]
    const samples = version === 3 ? 1152 : 576
    const length = Math.floor((samples / 8) * kbps * 1000 / sampleRate) + ((b2 >> 1) & 1)
    // An encoder's Xing or Info frame describes the file and plays nothing.
    const head = buf.subarray(i + 4, i + 40).toString('latin1')
    if (!head.includes('Xing') && !head.includes('Info')) seconds += samples / sampleRate
    i += length
  }
  return seconds
}

// As a script: the recordings into the site, in place of any copied before.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(SERVED, { recursive: true, force: true })
  const table = recordedSounds()
  if (Object.keys(table).length) fs.mkdirSync(SERVED, { recursive: true })
  for (const name of Object.keys(table)) fs.copyFileSync(path.join(SOUNDS_DIR, `${name}.mp3`), path.join(SERVED, `${name}.mp3`))
  console.log(`codex sounds: ${Object.keys(table).length} recording(s) in public/sim-assets/codex/sounds/`)
}
