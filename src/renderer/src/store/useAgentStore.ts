import type { Unsubscribable } from '@trpc/client'
import { create } from 'zustand'

import { trpcClient } from '../trpc'
import type { ExecutorResult, ExecutorRunInput, ExecutorStreamEvent } from '../../../shared/trpc'

type AgentState = {
  systemPrompt: string
  userIntent: string
  model: string
  maxIterations: string
  autoApprove: boolean
  events: ExecutorStreamEvent[]
  finalResult: ExecutorResult | null
  streamError: string | null
  isStreaming: boolean
  setSystemPrompt: (value: string) => void
  setUserIntent: (value: string) => void
  setModel: (value: string) => void
  setMaxIterations: (value: string) => void
  setAutoApprove: (value: boolean) => void
  clearRun: () => void
  executeIntent: () => void
  stopExecution: () => void
}

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
const DEFAULT_USER_INTENT = 'Draft a short greeting and list three ideas.'
const DEFAULT_MODEL = 'gpt-5.1-codex'
const DEFAULT_MAX_ITERATIONS = '8'

let activeSubscription: Unsubscribable | null = null

const normalizeMaxIterations = (value: string): number | undefined => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

const stopActiveSubscription = (): void => {
  if (activeSubscription) {
    activeSubscription.unsubscribe()
    activeSubscription = null
  }
}

export const useAgentStore = create<AgentState>((set, get) => ({
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  userIntent: DEFAULT_USER_INTENT,
  model: DEFAULT_MODEL,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  autoApprove: false,
  events: [],
  finalResult: null,
  streamError: null,
  isStreaming: false,
  setSystemPrompt: (value) => set({ systemPrompt: value }),
  setUserIntent: (value) => set({ userIntent: value }),
  setModel: (value) => set({ model: value }),
  setMaxIterations: (value) => set({ maxIterations: value }),
  setAutoApprove: (value) => set({ autoApprove: value }),
  clearRun: () =>
    set({
      events: [],
      finalResult: null,
      streamError: null,
    }),
  executeIntent: () => {
    const { systemPrompt, userIntent, model, maxIterations, autoApprove } = get()
    const trimmedSystemPrompt = systemPrompt.trim()
    const trimmedIntent = userIntent.trim()
    const trimmedModel = model.trim()

    if (!trimmedSystemPrompt || !trimmedIntent || !trimmedModel) {
      set({ streamError: 'System prompt, intent, and model are required.' })
      return
    }

    stopActiveSubscription()
    set({
      events: [],
      finalResult: null,
      streamError: null,
      isStreaming: true,
    })

    const maxIterationsValue = normalizeMaxIterations(maxIterations)

    const input: ExecutorRunInput = {
      systemPrompt: trimmedSystemPrompt,
      userIntent: trimmedIntent,
      model: trimmedModel,
      ...(maxIterationsValue ? { maxIterations: maxIterationsValue } : {}),
      ...(autoApprove ? { autoApprove: true } : {}),
    }

    activeSubscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        set((state) => ({
          events: [...state.events, event],
          ...(event.event === 'executor.complete'
            ? { finalResult: event.result, isStreaming: false }
            : {}),
        }))
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        set({ streamError: message, isStreaming: false })
        stopActiveSubscription()
      },
      onComplete: () => {
        set({ isStreaming: false })
        stopActiveSubscription()
      },
    })
  },
  stopExecution: () => {
    stopActiveSubscription()
    set({ isStreaming: false })
  },
}))
