import { contextBridge, ipcRenderer } from 'electron'

type AppVersions = {
  electron: string
  chrome: string
  node: string
}

type ElectronTRPCBridge = {
  sendMessage: (args: unknown) => void
  onMessage: (callback: (args: unknown) => void) => void
}

const fallbackVersions: AppVersions = {
  electron: 'unknown',
  chrome: 'unknown',
  node: 'unknown'
}

const versions: AppVersions =
  typeof process === 'object' && process.versions
    ? {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      }
    : fallbackVersions

const ELECTRON_TRPC_CHANNEL = 'electron-trpc'

const electronTRPC: ElectronTRPCBridge = {
  sendMessage: (args) => ipcRenderer.send(ELECTRON_TRPC_CHANNEL, args),
  onMessage: (callback) => {
    ipcRenderer.on(ELECTRON_TRPC_CHANNEL, (_event, args) => {
      callback(args as unknown)
    })
  }
}

// Custom APIs for renderer
const api = { versions }

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('electronTRPC', electronTRPC)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.electronTRPC = electronTRPC
}
