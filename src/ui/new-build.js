/**
 * Keeps an open page on the build the site now serves.
 *
 * The service worker keeps the site for offline use. After a deploy, a
 * returning visitor's page still starts from the build it kept; the new
 * service worker then takes over and drops that build's files. The open page
 * loads some of its parts only when they are first needed (the simulator's
 * picture, its worker, its styles), and those are gone: the simulator would
 * stop before it started. So when a new build takes over, or a part of the
 * page fails to load, the page saves the student's work and reloads once onto
 * the new build. A reload within the last minute is not repeated, so a part
 * that is really missing can never make the page reload over and over.
 */

const LAST_RELOAD = 'opencodebot.newBuildReload'
const QUIET_MS = 60_000

// Chrome, Firefox and Safari say a module failed to load in these words.
const MISSING_PART = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

/** True for the error a page gets when one of its parts is no longer on the server. */
export function isMissingPart(err) {
  return MISSING_PART.test(String(err?.message ?? err ?? ''))
}

/**
 * @param {() => void} save  puts the student's work where a reload finds it
 * @param {{ reload?: () => void }} [opts]  for tests
 */
export function followNewBuilds(save, { reload = () => location.reload() } = {}) {
  const reloadOnce = () => {
    try {
      if (Date.now() - Number(sessionStorage.getItem(LAST_RELOAD) || 0) < QUIET_MS) return false
      sessionStorage.setItem(LAST_RELOAD, String(Date.now()))
    } catch {
      return false // with no way to remember the reload, a loop is possible: do not start one
    }
    save()
    reload()
    return true
  }

  // A page that a service worker already served is on the build it kept; a
  // first visit came from the network and is already on the new one.
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)
  }
  // Without a service worker in the way (or if it took over before this ran),
  // a stale page finds out when a part fails to load.
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadOnce()) e.preventDefault()
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (isMissingPart(e.reason) && reloadOnce()) e.preventDefault()
  })
}
