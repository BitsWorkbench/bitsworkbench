/**
 * Where a student's files live. The app talks to a FileStore and never to
 * the storage under it, so another kind of storage (a signed-in student's
 * own area online, say) is one more class with these methods, not a change
 * to the app.
 *
 * A FileStore (every method async unless marked):
 * - `name`                    the open folder's name, or null (property)
 * - `remembered()`            the name of a folder that can be reopened, or null
 * - `pickFolder()`            ask the student for a folder; its name, or null if they cancelled
 * - `reopen()`                reopen the remembered folder (call from a click); its name, or null
 * - `list(dir)`               the entries of a folder path ('' for the top):
 *                             [{ name, path, kind: 'file' | 'dir' }], folders first
 * - `read(path)`              a file's text
 * - `write(path, text)`       save a file's text, making the file if it is not there
 * - `exists(path)`            whether a file is there
 *
 * Paths use '/' and are relative to the open folder.
 */
import { LocalFolderStore } from './local-folder.js'

/** The store for this browser, or null where no folder can be opened (the app then opens and downloads single files). */
export function createFileStore() {
  return LocalFolderStore.supported() ? new LocalFolderStore() : null
}
