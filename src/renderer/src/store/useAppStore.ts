import { create } from 'zustand'

type AppMode = 'generate' | 'research' | 'automation'

type AppState = {
  currentMode: AppMode
  selectedModel: string
  useVimMode: boolean
  focusEditor: {
    isOpen: boolean
    content: string
    onSave: (newText: string) => void
  } | null
  setMode: (mode: AppMode) => void
  setSelectedModel: (model: string) => void
  setUseVimMode: (value: boolean) => void
  openFocusEditor: (content: string, onSave: (newText: string) => void) => void
  closeFocusEditor: () => void
}

export const useAppStore = create<AppState>((set) => ({
  currentMode: 'generate',
  selectedModel: 'gemini-2.0-flash',
  useVimMode: true,
  focusEditor: null,
  setMode: (mode) => set({ currentMode: mode }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setUseVimMode: (value) => set({ useVimMode: value }),
  openFocusEditor: (content, onSave) => set({ focusEditor: { isOpen: true, content, onSave } }),
  closeFocusEditor: () => set({ focusEditor: null })
}))
