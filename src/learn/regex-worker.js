// Tests one of a pack's regular expressions against one line, away from the
// page, so a slow one can be stopped (regex.js).
self.onmessage = (e) => {
  const { id, source, text } = e.data
  let match = false
  try {
    match = new RegExp(source).test(text)
  } catch {
    // The pack reader checked it compiles; nothing more to do here.
  }
  self.postMessage({ id, match })
}
