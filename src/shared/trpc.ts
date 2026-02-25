import { initTRPC } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

import type { AgentEvent } from './agent-events'

const t = initTRPC.create()

export type TextPart = { type: 'text'; text: string }
export type ImagePart = { type: 'image'; mimeType: string; data: string }
export type VideoPart = { type: 'video_uri'; mimeType: string; fileUri: string }
export type PdfPart = {
  type: 'pdf'
  mimeType: 'application/pdf'
  filePath: string
  fileUri?: string
}

export type MessageContent = string | (TextPart | ImagePart | VideoPart | PdfPart)[]

export type ToolCall = {
  id?: string
  name: string
  arguments: unknown
}

export type ToolExecutionPlan = {
  toolName: string
  callId?: string
  args: Record<string, unknown>
  argsSummary: string[]
  summary: string
  risk: 'safe' | 'dangerous'
  riskReason?: string
  preflight: string[]
  steps: string[]
  expectedOutputs: string[]
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: MessageContent
  toolCalls?: ToolCall[]
  tool_calls?: ToolCall[]
  toolCallId?: string
  tool_call_id?: string
}

export type ExecutorErrorCode =
  | 'LLM_CALL_FAILED'
  | 'LLM_RESPONSE_INVALID'
  | 'TOOL_CALL_PARSE_ERROR'
  | 'TOOL_CALL_VALIDATION_ERROR'
  | 'TOOL_PLAN_ERROR'
  | 'MAX_ITERATIONS_EXCEEDED'
  | 'TOOL_REGISTRY_INVALID'

export type ExecutorError = {
  code: ExecutorErrorCode
  message: string
  details?: {
    toolName?: string
    callIndex?: number
    errorMessage?: string
    source?: 'llm_tool_calls' | 'content_json' | 'content_text'
    parseCode?: string
    planCode?: string
    maxIterations?: number
    bestKnownText?: string
  }
}

export type ExecutorSuccess = {
  ok: true
  value: {
    text: string
    messages: Message[]
    toolCalls?: ToolCall[]
    toolPlans?: ToolExecutionPlan[]
  }
}

export type ExecutorFailure = {
  ok: false
  error: ExecutorError
  messages: Message[]
  toolPlans?: ToolExecutionPlan[]
}

export type ExecutorResult = ExecutorSuccess | ExecutorFailure

export type ExecutorRunInput = {
  systemPrompt: string
  userIntent: string
  model: string
  maxIterations?: number
  autoApprove?: boolean
  attachments?: string[]
}

export type ToolApprovalRequiredEvent = {
  event: 'tool_approval_required'
  timestamp: string
  callId: string
  toolName: string
  plan: ToolExecutionPlan
}

export type ExecutorStreamEvent =
  | (AgentEvent & { timestamp: string })
  | ToolApprovalRequiredEvent
  | { event: 'executor.complete'; timestamp: string; result: ExecutorResult }

export const executorRunInputSchema = z.object({
  systemPrompt: z.string().min(1),
  userIntent: z.string().min(1),
  model: z.string().min(1),
  maxIterations: z.number().int().positive().optional(),
  autoApprove: z.boolean().optional(),
  attachments: z.array(z.string()).optional(),
})

export const resolveToolApprovalInputSchema = z.object({
  callId: z.string().min(1),
  approved: z.boolean(),
})

type ExecutorRouterDeps = {
  runExecutor: (input: ExecutorRunInput) => Promise<ExecutorResult>
  streamExecutor: (
    input: ExecutorRunInput,
    emit: (event: ExecutorStreamEvent) => void,
  ) => Promise<void>
  resolveToolApproval: (input: { callId: string; approved: boolean }) => Promise<{ ok: boolean }>
  selectFiles: () => Promise<string[]>
}

export const createAppRouter = (deps: ExecutorRouterDeps) => {
  return t.router({
    ping: t.procedure.query(() => 'pong'),
    executorRun: t.procedure
      .input(executorRunInputSchema)
      .mutation(async ({ input }) => deps.runExecutor(input)),
    executorStream: t.procedure.input(executorRunInputSchema).subscription(({ input }) => {
      return observable<ExecutorStreamEvent>((observer) => {
        let active = true

        const emit = (event: ExecutorStreamEvent): void => {
          if (!active) {
            return
          }
          observer.next(event)
        }

        void deps
          .streamExecutor(input, emit)
          .then(() => {
            if (active) {
              observer.complete()
            }
          })
          .catch((error) => {
            if (active) {
              observer.error(error instanceof Error ? error : new Error('Executor stream failed.'))
            }
          })

        return () => {
          active = false
        }
      })
    }),
    resolveToolApproval: t.procedure
      .input(resolveToolApprovalInputSchema)
      .mutation(async ({ input }) => deps.resolveToolApproval(input)),
    selectFiles: t.procedure.query(async () => deps.selectFiles()),
  })
}

export type AppRouter = ReturnType<typeof createAppRouter>
