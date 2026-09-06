import { app, shell, BrowserWindow, nativeTheme, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createAppCore } from '../core/appCore'

const { deviceManager, sessionManager } = createAppCore()

// Referência à janela única do app, usada só para empurrar eventos de console
// assim que chegam (o preload nunca fala com o SessionManager diretamente).
let mainWindow: BrowserWindow | undefined

sessionManager.onConsoleEntry((deviceId, entry) => {
  mainWindow?.webContents.send('console:message', deviceId, entry)
})

sessionManager.onDebuggerState((deviceId, state) => {
  mainWindow?.webContents.send('debugger:update', deviceId, state)
})

function createWindow(): void {
  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: 'My DevTools',
    autoHideMenuBar: true,
    // Cor de fundo enquanto o renderer carrega, evita flash. O processo main não
    // lê CSS vars — este literal segue o token `background` do DESIGN.md.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0f' : '#ffffff',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // Postura de segurança do IPC: renderer sem acesso a Node, e a única ponte
      // com o processo main é o preload via contextBridge.
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow = browserWindow

  browserWindow.on('ready-to-show', () => {
    browserWindow.show()
  })

  browserWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    browserWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    browserWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.mydevtools.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Descoberta de dispositivos: o renderer pede a lista via preload (window.api),
  // o DeviceManager faz o polling real do Metro em segundo plano.
  ipcMain.handle('devices:list', () => deviceManager.list())
  // REPL do painel Console: roda a expressão via CDP no device selecionado.
  // Nunca lança para o renderer — sempre um EvaluateResult.
  ipcMain.handle('devices:evaluate', (_event, deviceId: string, expression: string) =>
    sessionManager.evaluate(deviceId, expression)
  )
  // Painel Console: garante a conexão CDP do device e devolve o que já foi
  // capturado. Eventos novos chegam depois via `console:message` (ver acima).
  ipcMain.handle('devices:consoleEntries', (_event, deviceId: string) =>
    sessionManager.consoleEntries(deviceId)
  )
  // Painel Debugger: mesma lógica do Console (estado inicial via invoke,
  // atualizações ao vivo via `debugger:update`). Comandos nunca lançam pro
  // renderer — sempre um DebuggerCommandResult.
  ipcMain.handle('devices:debuggerState', (_event, deviceId: string) =>
    sessionManager.debuggerState(deviceId)
  )
  // Sem visualizador de código, é a única forma de saber o que digitar num
  // breakpoint — lista os arquivos-fonte do source map do bundle.
  ipcMain.handle('devices:knownSourceFiles', (_event, deviceId: string) =>
    sessionManager.knownSourceFiles(deviceId)
  )
  ipcMain.handle(
    'devices:setBreakpoint',
    (_event, deviceId: string, file: string, lineNumber: number) =>
      sessionManager.setBreakpoint(deviceId, file, lineNumber)
  )
  ipcMain.handle('devices:removeBreakpoint', (_event, deviceId: string, breakpointId: string) =>
    sessionManager.removeBreakpoint(deviceId, breakpointId)
  )
  ipcMain.handle('devices:debuggerResume', (_event, deviceId: string) =>
    sessionManager.resume(deviceId)
  )
  ipcMain.handle('devices:debuggerStepOver', (_event, deviceId: string) =>
    sessionManager.stepOver(deviceId)
  )
  ipcMain.handle('devices:debuggerStepInto', (_event, deviceId: string) =>
    sessionManager.stepInto(deviceId)
  )
  ipcMain.handle('devices:debuggerStepOut', (_event, deviceId: string) =>
    sessionManager.stepOut(deviceId)
  )
  deviceManager.start()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  deviceManager.stop()
  void sessionManager.disposeAll()
})
