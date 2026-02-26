import { create } from 'zustand'

type AppMode = 'generate' | 'research' | 'automation'

type AppState = {
  currentMode: AppMode
  selectedModel: string
  setMode: (mode: AppMode) => void
  setSelectedModel: (model: string) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentMode: 'generate',
  selectedModel: 'gemini-2.0-flash',
  setMode: (mode) => set({ currentMode: mode }),
  setSelectedModel: (model) => set({ selectedModel: model })
}))
