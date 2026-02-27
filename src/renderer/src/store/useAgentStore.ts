import { create } from 'zustand'

import { trpcClient } from '../trpc'
import { useAppStore } from './useAppStore'
import type {
  ExecutorResult,
  ExecutorRunInput,
  ExecutorStreamEvent,
  Message,
  ValidationReport,
  ToolExecutionPlan,
  SessionRecord
} from '../../../shared/trpc'

type Unsubscribable = { unsubscribe: () => void }

type AgentState = {
  systemPrompt: string
  userIntent: string
  maxIterations: string
  autoApprove: boolean
  attachments: string[]
  chatHistory: Message[]
  events: ExecutorStreamEvent[]
  finalResult: ExecutorResult | null
  validationReport: ValidationReport | null
  isValidating: boolean
  isSettingsOpen: boolean
  streamError: string | null
  isStreaming: boolean
  pendingApproval: { callId: string; toolName: string; plan: ToolExecutionPlan } | null
  activeSessionId: string | null
  sessions: SessionRecord[]
  setSystemPrompt: (value: string) => void
  setUserIntent: (value: string) => void
  setMaxIterations: (value: string) => void
  setAutoApprove: (value: boolean) => void
  addAttachments: (paths: string[]) => void
  removeAttachment: (path: string) => void
  clearAttachments: () => void
  clearRun: () => void
  clearHistory: () => void
  runValidation: (text: string) => Promise<void>
  openSettings: () => void
  closeSettings: () => void
  executeIntent: () => Promise<void>
  stopExecution: () => void
  submitApproval: (approved: boolean) => Promise<void>
  setActiveSessionId: (sessionId: string | null) => void
  loadSessions: () => Promise<void>
  startNewSession: () => void
  loadSessionMessages: (sessionId: string) => Promise<void>
}

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
const DEFAULT_USER_INTENT = 'Draft a short greeting and list three ideas.'
const DEFAULT_MAX_ITERATIONS = '8'

let activeSubscription: Unsubscribable | null = null

const parseMessages = (records: Array<{ role: string; content: string }>): Message[] => {
  return records.map((record) => {
    if (record.role === 'assistant') {
      try {
        const parsed = JSON.parse(record.content) as {
          content?: string
          toolCalls?: unknown
        }
        const content = typeof parsed.content === 'string' ? parsed.content : record.content
        const message: Message = { role: 'assistant', content }
        if (Array.isArray(parsed.toolCalls)) {
          message.toolCalls = parsed.toolCalls
        }
        return message
      } catch {
        return { role: 'assistant', content: record.content }
      }
    }

    if (record.role === 'system') {
      return { role: 'system', content: record.content }
    }

    return { role: 'user', content: record.content }
  })
}

const extractLatestUserIntent = (messages: Message[]): string => {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  if (!lastUser) {
    return ''
  }
  return typeof lastUser.content === 'string' ? lastUser.content : ''
}

const buildStoredExecutorResult = (messages: Message[], fallbackText: string): ExecutorResult => {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
  const text =
    lastAssistant && typeof lastAssistant.content === 'string'
      ? lastAssistant.content
      : fallbackText
  return {
    ok: true,
    value: {
      text,
      messages
    }
  }
}

const extractChatHistory = (messages: Message[]): Message[] => {
  return messages.filter((message) => message.role !== 'system')
}

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
  maxIterations: DEFAULT_MAX_ITERATIONS,
  autoApprove: false,
  attachments: [],
  chatHistory: [],
  events: [],
  finalResult: null,
  validationReport: null,
  isValidating: false,
  isSettingsOpen: false,
  streamError: null,
  isStreaming: false,
  pendingApproval: null,
  activeSessionId: null,
  sessions: [],
  setSystemPrompt: (value) => set({ systemPrompt: value }),
  setUserIntent: (value) => set({ userIntent: value }),
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
      finalResult: null,
      validationReport: null,
      isValidating: false,
      activeSessionId: null
    }),
  runValidation: async (text) => {
    set({ isValidating: true })
    try {
      const report = await trpcClient.validatePrompt.mutate({
        promptText: text,
        model: useAppStore.getState().selectedModel
      })
      set({ validationReport: report, isValidating: false })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation failed.'
      console.error(message)
      set({ validationReport: null, isValidating: false })
    }
  },
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  loadSessions: async () => {
    try {
      const data = await trpcClient.getSessions.query()
      set({ sessions: data })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load sessions.'
      console.error(message)
    }
  },
  startNewSession: () => {
    const { isStreaming, pendingApproval } = get()
    if (isStreaming || pendingApproval) {
      stopActiveSubscription()
    }
    set({
      activeSessionId: null,
      chatHistory: [],
      events: [],
      finalResult: null,
      validationReport: null,
      isValidating: false,
      streamError: null,
      pendingApproval: null,
      isStreaming: false,
      userIntent: ''
    })
  },
  loadSessionMessages: async (sessionId: string) => {
    try {
      const { isStreaming, pendingApproval } = get()
      if (isStreaming || pendingApproval) {
        stopActiveSubscription()
      }
      const records = await trpcClient.getSessionMessages.query({ sessionId })
      const parsedMessages = parseMessages(records)
      const userIntent = extractLatestUserIntent(parsedMessages)
      const finalResult = buildStoredExecutorResult(parsedMessages, userIntent)
      const lastTimestamp =
        records.length > 0
          ? new Date(records[records.length - 1]?.created_at ?? Date.now()).toISOString()
          : new Date().toISOString()
      set({
        activeSessionId: sessionId,
        chatHistory: parsedMessages,
        userIntent: userIntent || DEFAULT_USER_INTENT,
        events: [
          {
            event: 'executor.complete',
            timestamp: lastTimestamp,
            result: finalResult
          }
        ],
        finalResult,
        validationReport: null,
        isValidating: false,
        streamError: null,
        pendingApproval: null,
        isStreaming: false
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load session messages.'
      console.error(message)
    }
  },
  executeIntent: async () => {
    const {
      systemPrompt,
      userIntent,
      maxIterations,
      autoApprove,
      attachments,
      chatHistory,
      activeSessionId
    } = get()
    const trimmedSystemPrompt = systemPrompt.trim()
    const trimmedIntent = userIntent.trim()
    const trimmedModel = useAppStore.getState().selectedModel.trim()
    const persona = useAppStore.getState().activePersona
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
      validationReport: null,
      streamError: null,
      isStreaming: true,
      pendingApproval: null
    })

    let sessionIdForRun = activeSessionId
    if (!sessionIdForRun && chatHistory.length === 0) {
      const newSessionId = crypto.randomUUID()
      const title = trimmedIntent.length > 72 ? `${trimmedIntent.slice(0, 69)}...` : trimmedIntent
      try {
        await trpcClient.createSession.mutate({
          id: newSessionId,
          title: title || 'New Session',
          persona
        })
        set({ activeSessionId: newSessionId })
        sessionIdForRun = newSessionId
        void get().loadSessions()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create session.'
        set({ streamError: message, isStreaming: false, pendingApproval: null })
        return
      }
    }

    const maxIterationsValue = normalizeMaxIterations(maxIterations)

    const input: ExecutorRunInput = {
      systemPrompt: trimmedSystemPrompt,
      userIntent: trimmedIntent,
      model: trimmedModel,
      persona,
      ...(maxIterationsValue ? { maxIterations: maxIterationsValue } : {}),
      ...(autoApprove ? { autoApprove: true } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(historyForRun ? { history: historyForRun } : {})
    }

    get().clearAttachments()

    if (sessionIdForRun) {
      try {
        await trpcClient.saveMessage.mutate({
          id: crypto.randomUUID(),
          sessionId: sessionIdForRun,
          role: 'user',
          content: intentForRun
        })
        void get().loadSessions()
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to persist user message.'
        console.error(message)
      }
    }

    activeSubscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        const streamEvent = event as ExecutorStreamEvent
        if (streamEvent.event === 'executor.complete' && streamEvent.result.ok) {
          void get().runValidation(streamEvent.result.value.text)
          if (sessionIdForRun) {
            const assistantPayload = JSON.stringify({
              content: streamEvent.result.value.text,
              toolCalls: streamEvent.result.value.toolCalls ?? []
            })
            void (async () => {
              try {
                await trpcClient.saveMessage.mutate({
                  id: crypto.randomUUID(),
                  sessionId: sessionIdForRun,
                  role: 'assistant',
                  content: assistantPayload
                })
                await get().loadSessions()
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : 'Failed to persist assistant message.'
                console.error(message)
              }
            })()
          }
        }
        set((state) => {
          const nextEvents = [...state.events, streamEvent]
          const nextState: Partial<AgentState> = { events: nextEvents }

          if (streamEvent.event === 'executor.complete') {
            if (streamEvent.result.ok) {
              const fullHistory = streamEvent.result.value.messages
              nextState.chatHistory = fullHistory
                ? extractChatHistory(fullHistory)
                : [
                    ...state.chatHistory,
                    { role: 'user', content: intentForRun },
                    {
                      role: 'assistant',
                      content: streamEvent.result.value.text
                    }
                  ]
            }
            nextState.finalResult = streamEvent.result
            nextState.isStreaming = false
            nextState.pendingApproval = null
          }

          if (streamEvent.event === 'tool_approval_required') {
            nextState.pendingApproval = {
              callId: streamEvent.callId,
              toolName: streamEvent.toolName,
              plan: streamEvent.plan
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
