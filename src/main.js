import './styles/theme.css'
import './styles/app.css'
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'

import * as Blockly from 'blockly/core'
import { toolboxFor, generatePython } from './blocks/index.js'
import { App } from './ui/app.js'
import { missingMembers } from './device/device-target.js'
import { translatePage } from './i18n/index.js'
import { followNewBuilds } from './ui/new-build.js'

function start() {
  translatePage()
  window.openCodeBot = new App()
  // After the app restored the student's work, so a reload saves that work, not an empty one.
  followNewBuilds(() => window.openCodeBot.workspace.save())
  // Handy from the browser console, and used by the automated smoke tests.
  window.openCodeBotInternals = { Blockly, toolboxFor, generatePython, missingMembers }
}

// A language other than English loads before this module runs (i18n/index.js
// waits for it), and the page may have finished loading by then.
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start)
else start()
