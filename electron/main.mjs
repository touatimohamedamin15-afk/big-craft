// Desktop shell: starts the game server in the main process on a free local
// port and opens it in a window. `bun run desktop` runs it from source (after
// a build); `bun run package` makes installers in release/.
//
// LAN_HOST=0.0.0.0 lets others on your network join this window's server.
// ELECTRON_SMOKE=1 loads a hidden offline sandbox and an online room, reports
// whether the game booted, and quits.
import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const smoke = process.env.ELECTRON_SMOKE === '1'
const NAME = 'Buffcraft'

app.setName(NAME)
// One window per machine: a second launch focuses the first.
if (!smoke && !app.requestSingleInstanceLock()) app.quit()

let win = null
let origin = ''

/** Window size and position, remembered between launches. */
const stateFile = () => join(app.getPath('userData'), 'window.json')
function loadWindowState() {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8'))
    if (Number.isFinite(s.width) && Number.isFinite(s.height)) return s
  } catch {}
  return { width: 1280, height: 800 }
}
function saveWindowState() {
  if (!win || win.isDestroyed()) return
  try {
    writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  } catch {}
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ label: NAME, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Game', submenu: [{ label: 'Back to menu', accelerator: 'CmdOrCtrl+Shift+M', click: () => win?.loadURL(`${origin}/`) }, ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }])] },
    { label: 'View', submenu: [{ role: 'togglefullscreen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function boot() {
  const serverEntry = join(here, '../dist/server/main.js')
  if (!existsSync(serverEntry)) {
    dialog.showErrorBox(NAME, 'The game has not been built yet. Run `bun run build:node` first.')
    return app.exit(1)
  }
  let port
  try {
    const { startServer } = await import(pathToFileURL(serverEntry).href)
    ;({ port } = await startServer({ port: Number(process.env.PORT) || 0, host: process.env.LAN_HOST ?? '127.0.0.1', staticDir: join(here, '../dist/node-client'), quiet: true }))
  } catch (error) {
    dialog.showErrorBox(NAME, `The game server could not start:\n${error?.message ?? error}`)
    return app.exit(1)
  }
  origin = `http://127.0.0.1:${port}`
  buildMenu()

  const state = loadWindowState()
  win = new BrowserWindow({
    ...state,
    minWidth: 800,
    minHeight: 520,
    title: NAME,
    show: false,
    backgroundColor: '#2b1d14',
    autoHideMenuBar: true,
    icon: join(here, '../build/icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  })
  if (state.maximized) win.maximize()
  win.on('close', saveWindowState)
  // Stay on the game's own origin; anything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') dialog.showErrorBox(NAME, `The game window stopped (${details.reason}). It will reload.`)
    win?.loadURL(`${origin}/`)
  })

  if (!smoke) {
    win.once('ready-to-show', () => win.show())
    return win.loadURL(`${origin}/`)
  }

  await win.loadURL(`${origin}/?play=1&offline=1&world=sandbox&name=Smoke`)
  const started = Date.now()
  const booted = async () => {
    while (Date.now() - started < 30000) {
      if (await win.webContents.executeJavaScript('!!(window.game && window.game.self && window.game.views.length > 1)')) return true
      await new Promise((r) => setTimeout(r, 250))
    }
    return false
  }
  const offline = await booted()
  await win.loadURL(`${origin}/?play=1&world=sandbox&name=Smoke&room=smoke`)
  const online = await booted()
  console.log(`electron smoke: offline ${offline ? 'ok' : 'FAILED'}, online ${online ? 'ok' : 'FAILED'}`)
  app.exit(offline && online ? 0 : 1)
}

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.whenReady().then(boot)
app.on('window-all-closed', () => app.quit())
