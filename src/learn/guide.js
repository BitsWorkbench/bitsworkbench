/**
 * Guided packs (docs/mission-packs.md, "Guided packs"): a pack whose every
 * mission is one journey plays with no drawer. The mission controller in
 * learn.js leads: at a mission's start the student chooses, once for the pack,
 * the simulator or their board on USB; the right board comes up; the coach
 * does the rest. The rail shows the mission and its chapters (the mission's
 * objectives), done, open or locked.
 *
 * Chapters and missions are done in order. A locked one is not out of reach:
 * the student is warned, and may unlock the next one (only that one).
 *
 * This file holds the rules (what is guided, what is done, open or locked,
 * the run choice kept per pack) and the words of the controller's cards.
 */
import { t } from '../i18n/index.js'
import { esc } from './esc.js'
import { journeyDone } from './journey/journey.js'

const RUN_ON = 'opencodebot.learn.runOn.v1' // { [pack id]: 'sim' | 'usb' }
/** In a journey's progress: the student unlocked this mission before the one before it was done. */
export const MISSION_UNLOCKED = '$open'
/** In a journey's progress: the student unlocked this chapter before the one before it was done. */
export const chapterUnlocked = (chapter) => `$open:${chapter.id}`

/** Is the pack guided: every mission one journey? */
export const isGuided = (pack) =>
  pack.missions.length > 0 && pack.missions.every((m) => m.flow.length === 1 && m.flow[0].type === 'journey')

/** A guided mission's journey. */
export const journeyOf = (mission) => mission.flow[0]

/** A chapter's steps in a mode. */
export const stepsIn = (chapter, mode) => chapter.steps.filter((s) => !s.mode || s.mode === mode)

/** Does a guided pack have words for Python (a `--Python--` section, or a Python-only step)? Then it can be played again in Python. */
export const speaksPython = (pack) =>
  pack.missions.some((m) => journeyOf(m).chapters.some((c) => c.steps.some((s) => s.mode === 'python' || /--Python--/.test(`${s.say ?? ''}${s.ask ?? ''}`))))

/**
 * Each chapter of a journey: 'done' (every step done), 'open' (the first, the
 * one after a done one, one already started, or one the student unlocked) or
 * 'locked'.
 */
export function chapterStates(journey, progress, mode) {
  const done = new Set(progress)
  const states = []
  journey.chapters.forEach((c, i) => {
    const steps = stepsIn(c, mode)
    if (steps.length && steps.every((s) => done.has(s.id))) return states.push('done')
    const open = i === 0 || states[i - 1] === 'done' || steps.some((s) => done.has(s.id)) || done.has(chapterUnlocked(c))
    states.push(open ? 'open' : 'locked')
  })
  return states
}

/** Each mission of a guided pack: 'done', 'open' or 'locked', from each journey's progress (in order). */
export function missionStates(progresses) {
  const states = []
  progresses.forEach((p, i) => {
    if (journeyDone(p)) return states.push('done')
    const open = i === 0 || states[i - 1] === 'done' || p.length > 0
    states.push(open ? 'open' : 'locked')
  })
  return states
}

/** The first mission not done (the last one when all are). */
export function firstToDo(states) {
  const i = states.findIndex((s) => s !== 'done')
  return i === -1 ? states.length - 1 : i
}

/** How the student runs a pack's missions: 'sim', 'usb', or null when not chosen yet. */
export function runOn(packId) {
  try {
    return JSON.parse(localStorage.getItem(RUN_ON))?.[packId] ?? null
  } catch {
    return null
  }
}

export function setRunOn(packId, how) {
  try {
    const all = JSON.parse(localStorage.getItem(RUN_ON)) || {}
    localStorage.setItem(RUN_ON, JSON.stringify({ ...all, [packId]: how }))
  } catch {
    // storage blocked: the student is asked again next time
  }
}

/** The run choice's words, for a board's name. */
export function runChoice(device) {
  return {
    title: t('guide.runTitle'),
    bodyHtml: `<p>${esc(t('guide.runBody', { device }))}</p>`,
    choices: [
      { value: 'sim', label: t('guide.runSim'), primary: true },
      { value: 'usb', label: t('guide.runUsb', { device }) },
    ],
  }
}

/** The missions card: the pack's missions, done, current, open or locked, and how they run. */
export function missionsHtml(pack, states, current, how, device) {
  const items = pack.missions
    .map((m, i) => {
      const s = states[i]
      const mark = s === 'done' ? '✓' : s === 'locked' ? '🔒' : i + 1
      const label = `${t('learn.missionN', { n: i + 1 })}: ${m.title}${s === 'done' ? ` ${t('learn.railDone')}` : s === 'locked' ? ` ${t('guide.locked')}` : ''}`
      return `<li><button type="button" class="ex-item guide-mission" data-guide-mission="${i}" data-state="${s}" aria-label="${esc(label)}"${i === current ? ' aria-current="true"' : ''}><span class="ex-num" aria-hidden="true">${mark}</span><span class="ex-text"><span class="ex-title">${esc(m.title)}</span>${m.brief ? `<span class="ex-goal">${esc(m.brief)}</span>` : ''}</span></button></li>`
    })
    .join('')
  const runs = how === 'usb' ? t('guide.runningUsb', { device }) : t('guide.runningSim')
  return `<ol class="ex-list guide-missions" aria-label="${esc(t('learn.missions'))}">${items}</ol>
    <p class="guide-runs">${esc(runs)} <button type="button" class="btn-plain learn-link" data-guide-run>${esc(t('guide.change'))}</button></p>
    ${pack.licence ? `<p class="learn-licence">${esc(pack.licence)}</p>` : ''}`
}

/** The warning before unlocking what follows an unfinished mission or chapter. */
export function unlockWarning(kind, title) {
  return {
    title: t('guide.lockedTitle'),
    bodyHtml: `<p>${esc(t(kind === 'mission' ? 'guide.lockedMission' : 'guide.lockedChapter', { title }))}</p>`,
    choices: [
      { value: 'back', label: t('guide.lockedBack'), primary: true },
      { value: 'unlock', label: t('guide.unlock', { title }) },
    ],
  }
}
