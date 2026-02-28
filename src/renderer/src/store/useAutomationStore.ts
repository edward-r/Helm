import { create } from 'zustand'

import { trpcClient } from '../trpc'
import { useAgentStore } from './useAgentStore'
import { useAppStore } from './useAppStore'
import type { ExecuteAgentInput, ExecutorStreamEvent } from '../../../shared/trpc'

type BatchStatus = 'idle' | 'running' | 'completed'
type ResultStatus = 'pending' | 'running' | 'success' | 'error'

const DEFAULT_TASK_PROMPT = 'Summarize this file and extract key action items.'

type FileResult = {
  status: ResultStatus
  output?: string
  errorMessage?: string
}

type AutomationState = {
  files: string[]
  taskPrompt: string
  batchStatus: BatchStatus
  results: Record<string, FileResult>
  addFiles: (paths: string[]) => void
  removeFile: (path: string) => void
  clearFiles: () => void
  setTaskPrompt: (value: string) => void
  resetBatch: () => void
  runBatch: () => Promise<void>
}

const buildPendingResults = (files: string[]): Record<string, FileResult> => {
  return files.reduce<Record<string, FileResult>>((acc, filePath) => {
    acc[filePath] = { status: 'pending' }
    return acc
  }, {})
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  files: [],
  taskPrompt: DEFAULT_TASK_PROMPT,
  batchStatus: 'idle',
  results: {},
  addFiles: (paths) =>
    set((state) => {
      const nextFiles = [...state.files]
      const nextResults = { ...state.results }
      for (const filePath of paths) {
        if (!nextFiles.includes(filePath)) {
          nextFiles.push(filePath)
        }
        if (!nextResults[filePath]) {
          nextResults[filePath] = { status: 'pending' }
        }
      }
      return { files: nextFiles, results: nextResults }
    }),
  removeFile: (path) =>
    set((state) => {
      const nextFiles = state.files.filter((item) => item !== path)
      const nextResults = { ...state.results }
      delete nextResults[path]
      return { files: nextFiles, results: nextResults }
    }),
  clearFiles: () => set({ files: [], results: {} }),
  setTaskPrompt: (value) => set({ taskPrompt: value }),
  resetBatch: () =>
    set((state) => ({
      batchStatus: 'idle',
      results: buildPendingResults(state.files)
    })),
  runBatch: async () => {
    const { files, taskPrompt, batchStatus } = get()
    if (batchStatus === 'running') {
      return
    }
    const trimmedPrompt = taskPrompt.trim()
    const trimmedModel = useAppStore.getState().selectedModel.trim()
    if (!trimmedPrompt || !trimmedModel || files.length === 0) {
      return
    }

    set({ batchStatus: 'running', results: buildPendingResults(files) })

    const systemPrompt =
      useAgentStore.getState().systemPrompt.trim() || 'You are a helpful assistant.'

    for (const filePath of files) {
      set((state) => ({
        results: {
          ...state.results,
          [filePath]: { status: 'running' }
        }
      }))

      await new Promise<void>((resolve) => {
        let resolved = false
        const finalize = () => {
          if (resolved) {
            return
          }
          resolved = true
          subscription.unsubscribe()
          resolve()
        }

        const input: ExecuteAgentInput = {
          systemPrompt,
          promptText: trimmedPrompt,
          model: trimmedModel,
          persona: useAppStore.getState().activePersona,
          attachments: [filePath],
          autoApprove: true
        }

        const subscription = trpcClient.executeAgent.subscribe(input, {
          onData: (event) => {
            const streamEvent = event as ExecutorStreamEvent
            if (streamEvent.event !== 'executor.complete') {
              return
            }
            const result = streamEvent.result
            if (result.ok) {
              set((state) => ({
                results: {
                  ...state.results,
                  [filePath]: { status: 'success', output: result.value.text }
                }
              }))
            } else {
              const errMsg = [
                result.error.code,
                result.error.message,
                result.error.details ? JSON.stringify(result.error.details) : ''
              ]
                .filter(Boolean)
                .join(': ')
              set((state) => ({
                results: {
                  ...state.results,
                  [filePath]: {
                    status: 'error',
                    output: errMsg,
                    errorMessage: errMsg
                  }
                }
              }))
            }
            finalize()
          },
          onError: (error) => {
            const message = error instanceof Error ? error.message : 'Unknown error'
            set((state) => ({
              results: {
                ...state.results,
                [filePath]: { status: 'error', output: message, errorMessage: message }
              }
            }))
            finalize()
          },
          onComplete: () => {
            finalize()
          }
        })
      })
    }

    set({ batchStatus: 'completed' })
  }
}))
