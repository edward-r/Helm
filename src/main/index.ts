import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'
import { createAppRouter } from '../shared/trpc'
import type { AppRouter, ExecutorRunInput, ExecutorStreamEvent } from '../shared/trpc'
import { executeExecutor, type ExecutorInput } from './agent/executor'
import icon from '../../resources/icon.png?asset'

let ipcHandler: ReturnType<typeof createIPCHandler<AppRouter>> | null = null

const timestamp = (): string => new Date().toISOString()

const createOnToolApproval = (autoApprove: boolean): ExecutorInput['onToolApproval'] => {
  return async ({ plan }) => {
    if (autoApprove) {
      return { approved: true }
    }
    return {
      approved: false,
      reason: `Tool "${plan.toolName}" requires approval and auto-approval is disabled.`,
    }
  }
}

const runExecutor = async (input: ExecutorRunInput) => {
  const autoApprove = input.autoApprove === true
  return executeExecutor({
    systemPrompt: input.systemPrompt,
    userIntent: input.userIntent,
    model: input.model,
    maxIterations: input.maxIterations,
    onToolApproval: createOnToolApproval(autoApprove),
  })
}

const streamExecutor = async (
  input: ExecutorRunInput,
  emit: (event: ExecutorStreamEvent) => void,
): Promise<void> => {
  const autoApprove = input.autoApprove === true
  const onThinkingEvent: ExecutorInput['onThinkingEvent'] = (event) => {
    emit({ ...event, timestamp: timestamp() })
  }
  const onToolEvent: ExecutorInput['onToolEvent'] = (event) => {
    emit({ ...event, timestamp: timestamp() })
  }

  const result = await executeExecutor({
    systemPrompt: input.systemPrompt,
    userIntent: input.userIntent,
    model: input.model,
    maxIterations: input.maxIterations,
    onThinkingEvent,
    onToolEvent,
    onToolApproval: createOnToolApproval(autoApprove),
  })

  emit({ event: 'executor.complete', timestamp: timestamp(), result })
}

const appRouter = createAppRouter({
  runExecutor,
  streamExecutor,
})

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerWindow(window: BrowserWindow): void {
  if (!ipcHandler) {
    ipcHandler = createIPCHandler({
      router: appRouter,
      windows: [window]
    })
    return
  }

  ipcHandler.attachWindow(window)
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.helm.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const mainWindow = createWindow()
  registerWindow(mainWindow)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow()
      registerWindow(newWindow)
    }
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
