import { create } from 'zustand'

import { trpcClient } from '../trpc'
import type { ExecutorRunInput, ExecutorStreamEvent, Message } from '../../../shared/trpc'

type Unsubscribable = { unsubscribe: () => void }

type TestState = {
  isOpen: boolean
  systemPrompt: string
  chatHistory: Message[]
  isStreaming: boolean
  streamError: string | null
  openPlayground: (prompt: string) => void
  closePlayground: () => void
  clearTestHistory: () => void
  runTest: (userIntent: string, model: string) => void
}

let activeSubscription: Unsubscribable | null = null

const stopActiveSubscription = (): void => {
  if (activeSubscription) {
    activeSubscription.unsubscribe()
    activeSubscription = null
  }
}

const resolveAssistantResponse = (event: ExecutorStreamEvent): string => {
  if (event.event !== 'executor.complete') {
    return ''
  }
  if (event.result.ok) {
    return event.result.value.text
  }
  return event.result.error.message
}

export const useTestStore = create<TestState>((set, get) => ({
  isOpen: false,
  systemPrompt: '',
  chatHistory: [],
  isStreaming: false,
  streamError: null,
  openPlayground: (prompt) => {
    stopActiveSubscription()
    set({
      isOpen: true,
      systemPrompt: prompt,
      chatHistory: [],
      isStreaming: false,
      streamError: null
    })
  },
  closePlayground: () => {
    stopActiveSubscription()
    set({ isOpen: false, isStreaming: false })
  },
  clearTestHistory: () => {
    stopActiveSubscription()
    set({ chatHistory: [], streamError: null, isStreaming: false })
  },
  runTest: (userIntent, model) => {
    const trimmedIntent = userIntent.trim()
    const trimmedModel = model.trim()
    const { systemPrompt, chatHistory } = get()
    const trimmedSystemPrompt = systemPrompt.trim()

    if (!trimmedIntent || !trimmedModel || !trimmedSystemPrompt) {
      set({ streamError: 'System prompt, intent, and model are required.' })
      return
    }

    const userMessage: Message = { role: 'user', content: trimmedIntent }
    const nextHistory = [...chatHistory, userMessage]

    stopActiveSubscription()
    set({ chatHistory: nextHistory, isStreaming: true, streamError: null })

    const input: ExecutorRunInput = {
      systemPrompt: trimmedSystemPrompt,
      userIntent: trimmedIntent,
      model: trimmedModel,
      history: chatHistory
    }

    activeSubscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        const streamEvent = event as ExecutorStreamEvent
        if (streamEvent.event !== 'executor.complete') {
          return
        }
        const assistantMessage: Message = {
          role: 'assistant',
          content: resolveAssistantResponse(streamEvent)
        }
        set((state) => ({
          chatHistory: [...state.chatHistory, assistantMessage],
          isStreaming: false,
          streamError: streamEvent.result.ok ? null : streamEvent.result.error.message
        }))
        stopActiveSubscription()
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        set({ streamError: message, isStreaming: false })
        stopActiveSubscription()
      },
      onComplete: () => {
        set({ isStreaming: false })
        stopActiveSubscription()
      }
    })
  }
}))
