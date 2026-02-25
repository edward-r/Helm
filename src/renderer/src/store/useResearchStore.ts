import { create } from 'zustand'

import { trpcClient } from '../trpc'
import type { ExecutorResult, ExecutorRunInput, ExecutorStreamEvent } from '../../../shared/trpc'

type Unsubscribable = { unsubscribe: () => void }

export const RESEARCH_SYSTEM_PROMPT =
  "You are an expert Research Analyst. Your job is to compile a comprehensive, highly detailed markdown dossier on the user's topic. You MUST use the search_web and read_web_page tools to gather real-time, accurate information. Synthesize your findings, cite your sources with URLs, and format the final output as a structured markdown document."

type ResearchState = {
  topic: string
  events: ExecutorStreamEvent[]
  finalDossier: ExecutorResult | null
  isStreaming: boolean
  streamError: string | null
  setTopic: (value: string) => void
  executeResearch: (model: string) => void
}

let activeSubscription: Unsubscribable | null = null

const stopActiveSubscription = (): void => {
  if (activeSubscription) {
    activeSubscription.unsubscribe()
    activeSubscription = null
  }
}

export const useResearchStore = create<ResearchState>((set, get) => ({
  topic: '',
  events: [],
  finalDossier: null,
  isStreaming: false,
  streamError: null,
  setTopic: (value) => set({ topic: value }),
  executeResearch: (model) => {
    const topic = get().topic.trim()
    const trimmedModel = model.trim()

    if (!topic || !trimmedModel) {
      set({ streamError: 'Topic and model are required.' })
      return
    }

    stopActiveSubscription()
    set({ events: [], finalDossier: null, streamError: null, isStreaming: true })

    const input: ExecutorRunInput = {
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      userIntent: topic,
      model: trimmedModel,
      autoApprove: true
    }

    activeSubscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        const streamEvent = event as ExecutorStreamEvent
        set((state) => {
          const nextEvents = [...state.events, streamEvent]
          const nextState: Partial<ResearchState> = { events: nextEvents }

          if (streamEvent.event === 'executor.complete') {
            nextState.finalDossier = streamEvent.result
            nextState.isStreaming = false
          }

          return nextState
        })
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
