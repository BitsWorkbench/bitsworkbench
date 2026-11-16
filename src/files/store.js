/**
 * Where a student's files live. The app talks to FileStores and never to
 * the storage under them, so another kind of storage (a signed-in student's
 * own area online, say) is one more class with these methods, not a change
 * to the app.
 *
 * There are two: this browser's own storage, always there (browser-store.js),
 * and, where the browser can open one, a folder on the computer
 * (local-folder.js).
 *
 * A FileStore (every method async unless marked):
 * - `kind`                    'browser' or 'folder' (property)
 * - `name`                    the open folder's name, or null while none is open (property);
 *                             the browser's store is always open
 * - `list(dir)`               the entries of a folder path ('' for the top):
 *                             [{ name, path, kind: 'file' | 'dir' }], folders first
 * - `read(path)`              a file's text
 * - `write(path, text)`       save a file's text, making the file (and its folders) if not there
 * - `exists(path)`            whether a file or folder is there
 * - `mkdir(path)`             make a folder
 * - `remove(path)`            remove a file, or a folder and all in it
 * - `rename(from, to)`        rename or move a file or folder; fails if `to` is there
 * A folder store also has:
 * - `remembered()`            the name of a folder that can be reopened, or null
 * - `pickFolder()`            ask the student for a folder; its name, or null if they cancelled
 * - `reopen()`                reopen the remembered folder (call from a click); its name, or null
 *
 * Paths use '/' and are relative to the store's top.
 */
import { BrowserStore } from './browser-store.js'
import { LocalFolderStore } from './local-folder.js'

/** This browser's store, and the folder store where a folder can be opened (else null). */
export function createFileStores() {
  return { browser: new BrowserStore(), folder: LocalFolderStore.supported() ? new LocalFolderStore() : null }
}
