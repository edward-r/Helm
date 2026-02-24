type ElectronTRPCBridge = {
  sendMessage: (args: unknown) => void
  onMessage: (callback: (args: unknown) => void) => void
}

type AppVersions = {
  electron: string
  chrome: string
  node: string
}

type AppAPI = {
  versions: AppVersions
}

declare global {
  interface Window {
    api: AppAPI
    electronTRPC: ElectronTRPCBridge
  }
}
