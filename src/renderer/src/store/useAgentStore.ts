import { create } from 'zustand'

import { trpcClient } from '../trpc'
import type {
  ExecutorResult,
  ExecutorRunInput,
  ExecutorStreamEvent,
  Message,
  ToolExecutionPlan
} from '../../../shared/trpc'

type Unsubscribable = { unsubscribe: () => void }

type AgentState = {
  systemPrompt: string
  userIntent: string
  model: string
  maxIterations: string
  autoApprove: boolean
  attachments: string[]
  chatHistory: Message[]
  events: ExecutorStreamEvent[]
  finalResult: ExecutorResult | null
  streamError: string | null
  isStreaming: boolean
  pendingApproval: { callId: string; toolName: string; plan: ToolExecutionPlan } | null
  setSystemPrompt: (value: string) => void
  setUserIntent: (value: string) => void
  setModel: (value: string) => void
  setMaxIterations: (value: string) => void
  setAutoApprove: (value: boolean) => void
  addAttachments: (paths: string[]) => void
  removeAttachment: (path: string) => void
  clearAttachments: () => void
  clearRun: () => void
  clearHistory: () => void
  executeIntent: () => void
  stopExecution: () => void
  submitApproval: (approved: boolean) => Promise<void>
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
  attachments: [],
  chatHistory: [],
  events: [],
  finalResult: null,
  streamError: null,
  isStreaming: false,
  pendingApproval: null,
  setSystemPrompt: (value) => set({ systemPrompt: value }),
  setUserIntent: (value) => set({ userIntent: value }),
  setModel: (value) => set({ model: value }),
  setMaxIterations: (value) => set({ maxIterations: value }),
  setAutoApprove: (value) => set({ autoApprove: value }),
  addAttachments: (paths) =>
    set((state) => {
      const next = [...state.attachments]
      for (const filePath of paths) {
        if (!next.includes(filePath)) {
          next.push(filePath)
        }
      }
      return { attachments: next }
    }),
  removeAttachment: (path) =>
    set((state) => ({ attachments: state.attachments.filter((item) => item !== path) })),
  clearAttachments: () => set({ attachments: [] }),
  clearRun: () =>
    set({
      events: [],
      finalResult: null,
      streamError: null,
      pendingApproval: null
    }),
  clearHistory: () =>
    set({
      chatHistory: [],
      userIntent: DEFAULT_USER_INTENT,
      finalResult: null
    }),
  executeIntent: () => {
    const {
      systemPrompt,
      userIntent,
      model,
      maxIterations,
      autoApprove,
      attachments,
      chatHistory
    } = get()
    const trimmedSystemPrompt = systemPrompt.trim()
    const trimmedIntent = userIntent.trim()
    const trimmedModel = model.trim()
    const intentForRun = trimmedIntent
    const historyForRun = chatHistory.length > 0 ? chatHistory : undefined

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
      pendingApproval: null
    })

    const maxIterationsValue = normalizeMaxIterations(maxIterations)

    const input: ExecutorRunInput = {
      systemPrompt: trimmedSystemPrompt,
      userIntent: trimmedIntent,
      model: trimmedModel,
      ...(maxIterationsValue ? { maxIterations: maxIterationsValue } : {}),
      ...(autoApprove ? { autoApprove: true } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(historyForRun ? { history: historyForRun } : {})
    }

    get().clearAttachments()

    activeSubscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        set((state) => {
          const nextEvents = [...state.events, event]
          const nextState: Partial<AgentState> = { events: nextEvents }

          if (event.event === 'executor.complete') {
            if (event.result.ok) {
              const userMessage: Message = { role: 'user', content: intentForRun }
              const assistantMessage: Message = {
                role: 'assistant',
                content: event.result.value.text
              }
              nextState.chatHistory = [...state.chatHistory, userMessage, assistantMessage]
            }
            nextState.finalResult = event.result
            nextState.isStreaming = false
            nextState.pendingApproval = null
          }

          if (event.event === 'tool_approval_required') {
            nextState.pendingApproval = {
              callId: event.callId,
              toolName: event.toolName,
              plan: event.plan
            }
          }

          return nextState
        })
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        set({ streamError: message, isStreaming: false, pendingApproval: null })
        stopActiveSubscription()
      },
      onComplete: () => {
        set({ isStreaming: false, pendingApproval: null })
        stopActiveSubscription()
      }
    })
  },
  stopExecution: () => {
    stopActiveSubscription()
    set({ isStreaming: false, pendingApproval: null })
  },
  submitApproval: async (approved: boolean) => {
    const pendingApproval = get().pendingApproval
    if (!pendingApproval) {
      return
    }

    try {
      await trpcClient.resolveToolApproval.mutate({
        callId: pendingApproval.callId,
        approved
      })
      set({ pendingApproval: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send approval.'
      set({ streamError: message, pendingApproval: null })
    }
  }
}))
