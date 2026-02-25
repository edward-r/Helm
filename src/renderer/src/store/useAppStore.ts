import { create } from 'zustand'

type AppMode = 'generate' | 'research'

type AppState = {
  currentMode: AppMode
  setMode: (mode: AppMode) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentMode: 'generate',
  setMode: (mode) => set({ currentMode: mode })
}))
