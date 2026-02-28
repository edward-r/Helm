import { app, shell, BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { createIPCHandler } from 'electron-trpc/main'
import { createAppRouter } from '../shared/trpc'
import type {
  AppRouter,
  ExecuteAgentInput,
  ExecutorStreamEvent,
  GenerateDraftInput
} from '../shared/trpc'
import { executeExecutor, type ExecutorInput } from './agent/executor'
import { promptGeneratorService } from './agent/prompt-generator-service'
import { gatherSmartContext } from './agent/smart-context'
import { evaluatePrompt } from './agent/validator'
import { fetchAvailableModels, getConfig, updateConfig } from './config-manager'
import { sessionRouter } from './routers/session-router'
import icon from '../../resources/icon.png?asset'

let ipcHandler: ReturnType<typeof createIPCHandler<AppRouter>> | null = null

const pendingApprovals = new Map<string, (decision: { approved: boolean }) => void>()

const timestamp = (): string => new Date().toISOString()

const createOnToolApproval = (
  autoApprove: boolean,
  emit?: (event: ExecutorStreamEvent) => void
): ExecutorInput['onToolApproval'] => {
  return async ({ call, plan }) => {
    if (autoApprove) {
      return { approved: true }
    }

    const callId = call.id && call.id.trim().length > 0 ? call.id : randomUUID()

    if (emit) {
      emit({
        event: 'tool_approval_required',
        timestamp: timestamp(),
        callId,
        toolName: plan.toolName,
        plan
      })
    }

    const approvalPromise = new Promise<{ approved: boolean }>((resolve) => {
      pendingApprovals.set(callId, resolve)
    })

    return approvalPromise.then((decision) =>
      decision.approved ? { approved: true } : { approved: false }
    )
  }
}

const generateDraft = async (input: GenerateDraftInput): Promise<string> => {
  let smartContextXml = ''
  if (input.useSmartContext) {
    try {
      const smartContext = await gatherSmartContext(input.userIntent, undefined, input.model)
      smartContextXml = smartContext.xml
    } catch (error) {
      console.warn('Smart Context gathering failed. Proceeding without context.', error)
    }
  }

  return promptGeneratorService.generateContract({
    userIntent: input.userIntent,
    smartContextXml,
    model: input.model,
    useSeriesGeneration: input.useSeriesGeneration
  })
}

const executeAgent = async (
  input: ExecuteAgentInput,
  emit: (event: ExecutorStreamEvent) => void
): Promise<void> => {
  const autoApprove = input.autoApprove === true
  const onThinkingEvent: ExecutorInput['onThinkingEvent'] = (event) => {
    emit({ ...event, timestamp: timestamp() })
  }
  const onSystemPrompt: ExecutorInput['onSystemPrompt'] = (prompt) => {
    emit({ event: 'system_prompt', timestamp: timestamp(), prompt })
  }
  const onReasoningEvent: ExecutorInput['onReasoningEvent'] = (event) => {
    emit({ event: 'reasoning', timestamp: timestamp(), delta: event.delta })
  }
  const onToolEvent: ExecutorInput['onToolEvent'] = (event) => {
    emit({ ...event, timestamp: timestamp() })
  }

  const result = await executeExecutor({
    systemPrompt: input.systemPrompt,
    userIntent: input.promptText,
    model: input.model,
    maxIterations: input.maxIterations,
    attachments: input.attachments,
    history: input.history,
    persona: input.persona,
    onSystemPrompt,
    onThinkingEvent,
    onReasoningEvent,
    onToolEvent,
    onToolApproval: createOnToolApproval(autoApprove, emit)
  })

  emit({ event: 'executor.complete', timestamp: timestamp(), result })
}

const appRouter = createAppRouter(
  {
    generateDraft,
    executeAgent,
    getConfig: async () => getConfig(),
    updateConfig: async (updates) => {
      const next = await updateConfig(updates)
      if (next.openaiKey) {
        process.env.OPENAI_API_KEY = next.openaiKey
      } else {
        delete process.env.OPENAI_API_KEY
      }
      if (next.geminiKey) {
        process.env.GEMINI_API_KEY = next.geminiKey
      } else {
        delete process.env.GEMINI_API_KEY
      }
      return next
    },
    getModels: async () => fetchAvailableModels(),
    validatePrompt: async ({ promptText, model }) => evaluatePrompt(promptText, model),
    saveFileDirect: async ({ filePath, content }) => {
      await fs.promises.writeFile(filePath, content, 'utf8')
      return { success: true }
    },
    selectFiles: async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
      })
      return result.filePaths
    },
    resolveToolApproval: async ({ callId, approved }) => {
      const resolver = pendingApprovals.get(callId)
      if (!resolver) {
        return { ok: false }
      }
      resolver({ approved })
      pendingApprovals.delete(callId)
      return { ok: true }
    }
  },
  sessionRouter
)

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
  void getConfig().then((config) => {
    if (config.openaiKey) {
      process.env.OPENAI_API_KEY = config.openaiKey
    }
    if (config.geminiKey) {
      process.env.GEMINI_API_KEY = config.geminiKey
    }
  })
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
