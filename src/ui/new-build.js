/**
 * Mends a page left on an old build by a deploy.
 *
 * The service worker keeps the site for offline use. After a deploy, a
 * returning visitor's page still starts from the build it kept; the new
 * service worker then takes over and drops that build's files. A part the
 * page loads only when it is first needed (the simulator's picture, its
 * worker, their styles) is then gone, and the simulator would stop before it
 * started.
 *
 * The page does not reload just because a new build took over: in a class,
 * that would reload every open tab at once, dropping a connected CodeBot and
 * a running program, on pages that were working. It reloads only when a part
 * it needs is missing, so it is already broken: it saves the student's work
 * and reloads once onto the new build. A reload within the last minute is not
 * repeated, so a part that is really missing can never make the page reload
 * over and over.
 */

const LAST_RELOAD = 'opencodebot.newBuildReload'
const QUIET_MS = 60_000

// Chrome, Firefox and Safari say a module failed to load in these words.
const MISSING_PART = /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

/** True for the error a page gets when one of its parts is no longer on the server. */
export function isMissingPart(err) {
  return MISSING_PART.test(String(err?.message ?? err ?? ''))
}

let reloadOnce = () => false

/**
 * If the server no longer has `url`, the page reloads onto the new build.
 * Resolves true when the page is reloading.
 */
export async function reloadIfGone(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    return res.status === 404 && reloadOnce()
  } catch {
    return false // offline: the part is not missing, the network is
  }
}

/**
 * For a part that fails without naming itself (a worker whose script would
 * not load): if this page's own build is gone from the server, the part was
 * too, and the page reloads onto the new build. Resolves true when it does.
 */
export function reloadIfStale() {
  const entry = document.querySelector('script[type="module"][src]')
  return entry ? reloadIfGone(entry.src) : Promise.resolve(false)
}

/**
 * @param {() => void} save  puts the student's work where a reload finds it
 * @param {{ reload?: () => void }} [opts]  for tests
 */
export function followNewBuilds(save, { reload = () => location.reload() } = {}) {
  reloadOnce = () => {
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

  // A late part's module or its styles (Vite's loader says which). The server
  // is asked first: a part that failed on a flaky network, or offline, is not
  // gone, and the page carries on (the Python editor, loaded on the first
  // switch to Python, then leaves its text box as the editor).
  window.addEventListener('vite:preloadError', (e) => {
    const url = /https?:\/\/[^\s'"]+/.exec(String(e.payload?.message ?? ''))?.[0]
    if (url) reloadIfGone(url)
    else reloadIfStale()
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (isMissingPart(e.reason) && reloadOnce()) e.preventDefault()
  })
  // A stylesheet fails with no error a script sees: one added later says so
  // to the window; one the page linked is empty, or has no sheet, once the
  // page has loaded (the server is asked before anything reloads).
  window.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLLinkElement && e.target.rel === 'stylesheet') reloadIfGone(e.target.href)
    },
    true,
  )
  const checkSheets = () => {
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      let empty = true
      try {
        empty = !link.sheet || link.sheet.cssRules.length === 0
      } catch {
        empty = false // another site's sheet: its rules are not ours to read
      }
      if (empty) reloadIfGone(link.href)
    }
  }
  if (document.readyState === 'complete') checkSheets()
  else window.addEventListener('load', checkSheets, { once: true })
}
