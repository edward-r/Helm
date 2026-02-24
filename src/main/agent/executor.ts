import type { LLMResult, ToolCall, ToolDefinition } from '@prompt-maker/core'
import { callLLM, type Message } from '@prompt-maker/core'

import type { AgentTool } from './tools/tool-types'
import { ALL_TOOLS } from './tools'
import type { ThinkingEvent, ToolErrorEvent, ToolSuccessEvent } from '../../shared/agent-events'
import {
  parseToolCallsFromResult,
  type ToolCallParseError,
  type ToolCallSource,
} from './tool-call-parser'
import {
  buildToolExecutionPlan,
  type ToolExecutionPlan,
  type ToolPlanError,
} from './tool-execution-plan'
import {
  buildToolExecutionEnvelope,
  serializeToolExecutionEnvelope,
  type ToolExecutionEnvelope,
  type ToolExecutionError,
  type ToolExecutionIo,
  summarizeToolExecution,
} from './tool-execution-result'

export type ExecutorInput = {
  systemPrompt: string
  userIntent: string
  model: string
  tools?: AgentTool[]
  maxIterations?: number
  onThinkingEvent?: (event: ThinkingEvent) => void
  onToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>
  onToolEvent?: (event: ToolExecutionEvent) => void
}

export type ToolExecutionEvent = ToolSuccessEvent | ToolErrorEvent

export type ToolApprovalDecision = { approved: true } | { approved: false; reason?: string }

export type ToolApprovalRequest = {
  call: ToolCall
  plan: ToolExecutionPlan
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
    source?: ToolCallSource
    parseCode?: ToolCallParseError['code']
    planCode?: ToolPlanError['code']
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

export type NormalizedLLMResponse =
  | { kind: 'finalText'; text: string }
  | { kind: 'toolCalls'; calls: ToolCall[]; source: ToolCallSource }
  | { kind: 'toolCallError'; error: ToolCallParseError; source: ToolCallSource | null }
  | { kind: 'responseError'; message: string }

const DEFAULT_MAX_ITERATIONS = 20
const BEST_KNOWN_TEXT_MAX = 240

export const executeExecutor = async (input: ExecutorInput): Promise<ExecutorResult> => {
  const history = createInitialHistory(input.systemPrompt, input.userIntent)
  const toolDefinitions: ToolDefinition[] = ALL_TOOLS
  const registryError = validateToolRegistry(ALL_TOOLS)
  if (registryError) {
    return { ok: false, error: registryError, messages: history }
  }
  const toolExecutorsResult = resolveToolExecutors(input.tools)
  if (!toolExecutorsResult.ok) {
    return { ok: false, error: toolExecutorsResult.error, messages: history }
  }
  const toolExecutors = toolExecutorsResult.value
  const executorRegistryError = validateToolRegistry(toolExecutors)
  if (executorRegistryError) {
    return { ok: false, error: executorRegistryError, messages: history }
  }
  const toolMap = new Map<string, AgentTool>(
    toolExecutors.map((tool: AgentTool) => [tool.name, tool]),
  )
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS

  let currentHistory = history
  let lastPlans: ToolExecutionPlan[] | undefined
  let bestKnownText: string | null = null

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const callIndex = iteration + 1
    emitThinkingEvent(input.onThinkingEvent, {
      phase: 'llm_call_start',
      callIndex,
      iteration: callIndex,
      model: input.model,
      summary: 'Calling model…',
    })
    const startedAt = Date.now()
    let response: LLMResult
    try {
      response = await callLLM(currentHistory, input.model, toolDefinitions)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown model error.'
      emitThinkingEvent(input.onThinkingEvent, {
        phase: 'llm_call_end',
        callIndex,
        iteration: callIndex,
        model: input.model,
        result: 'error',
        durationMs: Date.now() - startedAt,
        summary: `Model call failed: ${errorMessage}`,
      })
      return {
        ok: false,
        error: {
          code: 'LLM_CALL_FAILED',
          message: 'Model call failed.',
          details: { callIndex, errorMessage },
        },
        messages: currentHistory,
      }
    }

    const normalized = normalizeLLMResult(response)

    const responseText = extractAssistantText(response)
    if (responseText && normalized.kind === 'toolCalls' && normalized.source === 'llm_tool_calls') {
      bestKnownText = truncateBestKnownText(responseText)
    }

    emitThinkingEvent(
      input.onThinkingEvent,
      buildThinkingEndEvent(normalized, callIndex, input.model, startedAt),
    )

    // Plain-text finalization: when no tool calls are present, return the
    // assistant text immediately and append it once to history.
    if (normalized.kind === 'finalText') {
      const assistantMessage = buildAssistantMessage(normalized.text, undefined)
      const finalHistory = appendMessages(currentHistory, assistantMessage)
      return {
        ok: true,
        value: {
          text: normalized.text,
          messages: finalHistory,
          ...(lastPlans ? { toolPlans: lastPlans } : {}),
        },
      }
    }

    if (normalized.kind === 'responseError') {
      emitThinkingEvent(input.onThinkingEvent, {
        phase: 'tool_call_error',
        callIndex,
        iteration: callIndex,
        model: input.model,
        result: 'error',
        errorCode: 'LLM_RESPONSE_INVALID',
        summary: normalized.message,
      })
      return {
        ok: false,
        error: {
          code: 'LLM_RESPONSE_INVALID',
          message: normalized.message,
          details: { callIndex },
        },
        messages: currentHistory,
      }
    }

    if (normalized.kind === 'toolCallError') {
      emitThinkingEvent(input.onThinkingEvent, {
        phase: 'tool_call_error',
        callIndex,
        iteration: callIndex,
        model: input.model,
        result: 'error',
        errorCode: normalized.error.code,
        summary: normalized.error.message,
      })
      return {
        ok: false,
        error: {
          code: 'TOOL_CALL_PARSE_ERROR',
          message: normalized.error.message,
          details: {
            callIndex,
            parseCode: normalized.error.code,
            ...(normalized.source ? { source: normalized.source } : {}),
          },
        },
        messages: currentHistory,
      }
    }

    const validation = validateToolCalls(normalized.calls, toolMap)
    if (!validation.ok) {
      emitThinkingEvent(input.onThinkingEvent, {
        phase: 'tool_call_error',
        callIndex,
        iteration: callIndex,
        model: input.model,
        result: 'error',
        errorCode: validation.error.code,
        summary: validation.error.message,
      })
      return {
        ok: false,
        error: validation.error,
        messages: currentHistory,
      }
    }

    emitThinkingEvent(input.onThinkingEvent, {
      phase: 'tool_call_detected',
      callIndex,
      iteration: callIndex,
      model: input.model,
      result: 'tool_calls',
      toolNames: Array.from(new Set(validation.value.map((call: ToolCall) => call.name))),
      summary: 'Tool calls detected.',
    })

    const plansResult = buildExecutionPlans(validation.value, toolMap)
    if (!plansResult.ok) {
      emitThinkingEvent(input.onThinkingEvent, {
        phase: 'tool_call_error',
        callIndex,
        iteration: callIndex,
        model: input.model,
        result: 'error',
        errorCode: plansResult.error.code,
        summary: plansResult.error.message,
      })
      return {
        ok: false,
        error: plansResult.error,
        messages: currentHistory,
      }
    }

    const plans = plansResult.value
    lastPlans = plans

    emitThinkingEvent(input.onThinkingEvent, {
      phase: 'tool_plan_built',
      callIndex,
      iteration: callIndex,
      model: input.model,
      result: 'tool_calls',
      toolNames: Array.from(new Set(plans.map((plan) => plan.toolName))),
      summary: 'Tool execution plan prepared.',
    })

    const assistantMessage = buildAssistantMessage('', validation.value)
    const toolMessages = await buildToolMessages(
      validation.value,
      toolMap,
      plans,
      input.onToolApproval,
      input.onToolEvent,
      callIndex,
    )
    currentHistory = appendMessages(currentHistory, assistantMessage, ...toolMessages)
  }

  // If the model never produced a plain-text answer (no tool calls), return a
  // controlled error. Any non-empty assistant text seen during tool-call turns
  // is surfaced as bestKnownText for diagnostics, but not returned as final output.
  return {
    ok: false,
    error: {
      code: 'MAX_ITERATIONS_EXCEEDED',
      message: `Executor exceeded maxIterations (${maxIterations}) without final response.`,
      details: {
        maxIterations,
        ...(bestKnownText ? { bestKnownText } : {}),
      },
    },
    messages: currentHistory,
    ...(lastPlans ? { toolPlans: lastPlans } : {}),
  }
}

const createInitialHistory = (systemPrompt: string, userIntent: string): Message[] => {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userIntent },
  ]
}

const buildAssistantMessage = (content: string | null, toolCalls?: ToolCall[]): Message => {
  const message: Message = {
    role: 'assistant',
    content: content ?? '',
  }

  if (toolCalls && toolCalls.length > 0) {
    message.toolCalls = toolCalls
  }

  return message
}

const buildToolMessages = async (
  toolCalls: ToolCall[],
  toolMap: Map<string, AgentTool>,
  plans: ToolExecutionPlan[],
  onToolApproval?: ExecutorInput['onToolApproval'],
  onToolEvent?: ExecutorInput['onToolEvent'],
  iteration?: number,
): Promise<Message[]> => {
  const messages: Message[] = []

  for (const [index, call] of toolCalls.entries()) {
    const toolCallId = call.id ?? `tool_call_${index + 1}`
    const callForExecution = call.id ? call : { ...call, id: toolCallId }
    const plan = plans[index]
    const approval = await resolveToolApproval(callForExecution, plan, onToolApproval)
    const toolResult = approval.approved
      ? await executeToolCall(callForExecution, toolMap)
      : buildDeniedToolResult(callForExecution, approval.reason)

    emitToolEvent(onToolEvent, toolResult, toolCallId, iteration)

    messages.push({
      role: 'tool',
      toolCallId,
      content: serializeToolExecutionEnvelope(toolResult),
    })
  }

  return messages
}

const resolveToolApproval = async (
  call: ToolCall,
  plan: ToolExecutionPlan | undefined,
  onToolApproval?: ExecutorInput['onToolApproval'],
): Promise<ToolApprovalDecision> => {
  if (!plan || plan.risk !== 'dangerous') {
    return { approved: true }
  }

  if (!onToolApproval) {
    return {
      approved: false,
      reason: 'Tool approval required but no confirmation handler is available.',
    }
  }

  try {
    return await onToolApproval({ call, plan })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool approval failed.'
    return { approved: false, reason: message }
  }
}

const buildDeniedToolResult = (call: ToolCall, reason?: string): ToolExecutionEnvelope => {
  return buildToolExecutionEnvelope({
    call,
    error: {
      code: 'TOOL_APPROVAL_DENIED',
      message: reason ?? `Tool "${call.name}" was denied before execution.`,
      details: {
        toolName: call.name,
        ...(call.id ? { toolCallId: call.id } : {}),
      },
    },
    durationMs: 0,
  })
}

const executeToolCall = async (
  call: ToolCall,
  toolMap: Map<string, AgentTool>,
): Promise<ToolExecutionEnvelope> => {
  const tool = toolMap.get(call.name)
  if (!tool) {
    return buildToolExecutionEnvelope({
      call,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool "${call.name}" is not registered.`,
      },
      durationMs: 0,
    })
  }

  const startedAt = Date.now()

  try {
    const output = await tool.execute(call.arguments)
    return buildToolExecutionEnvelope({
      call,
      output,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    const io = extractIoFromError(error)
    return buildToolExecutionEnvelope({
      call,
      error: buildExecutionError(error, io),
      io,
      durationMs: Date.now() - startedAt,
    })
  }
}

const extractIoFromError = (error: unknown): ToolExecutionIo => {
  if (!isRecord(error)) {
    return {}
  }
  return {
    ...(typeof error.stdout === 'string' ? { stdout: error.stdout } : {}),
    ...(typeof error.stderr === 'string' ? { stderr: error.stderr } : {}),
    ...(typeof error.exitCode === 'number' && Number.isFinite(error.exitCode)
      ? { exitCode: error.exitCode }
      : {}),
  }
}

const buildExecutionError = (error: unknown, io: ToolExecutionIo): ToolExecutionError => {
  const message = error instanceof Error ? error.message : 'Tool execution failed.'
  const details: Record<string, unknown> = {}
  if (isRecord(error) && typeof error.code === 'string') {
    details.code = error.code
  }
  if (io.exitCode !== undefined) {
    details.exitCode = io.exitCode
  }
  if (Object.keys(details).length > 0) {
    return {
      code: 'TOOL_EXECUTION_FAILED',
      message,
      details,
    }
  }
  return {
    code: 'TOOL_EXECUTION_FAILED',
    message,
  }
}

const appendMessages = (history: Message[], ...next: Message[]): Message[] => {
  return [...history, ...next]
}

type ThinkingPayload = Omit<ThinkingEvent, 'event'>

const emitThinkingEvent = (
  handler: ExecutorInput['onThinkingEvent'],
  payload: ThinkingPayload,
): void => {
  if (!handler) {
    return
  }
  handler({ event: 'thinking', ...payload })
}

const emitToolEvent = (
  handler: ExecutorInput['onToolEvent'],
  envelope: ToolExecutionEnvelope,
  toolCallId: string,
  iteration?: number,
): void => {
  if (!handler) {
    return
  }

  const durationMs = envelope.durationMs ?? 0
  const summary = summarizeToolExecution(envelope)
  if (envelope.ok) {
    handler({
      event: 'tool_success',
      toolName: envelope.toolName,
      toolCallId,
      durationMs,
      summary,
      ...(iteration !== undefined ? { iteration } : {}),
    })
    return
  }

  const errorMessage = envelope.error?.message ?? 'Tool execution failed.'
  const errorCode = envelope.error?.code
  handler({
    event: 'tool_error',
    toolName: envelope.toolName,
    toolCallId,
    durationMs,
    summary,
    errorMessage,
    ...(errorCode ? { errorCode } : {}),
    ...(iteration !== undefined ? { iteration } : {}),
  })
}

const buildThinkingEndEvent = (
  normalized: NormalizedLLMResponse,
  callIndex: number,
  model: string,
  startedAt: number,
): ThinkingPayload => {
  const durationMs = Date.now() - startedAt
  if (normalized.kind === 'finalText') {
    return {
      phase: 'llm_call_end',
      callIndex,
      iteration: callIndex,
      model,
      result: 'final_text',
      durationMs,
      summary: 'Model response received.',
    }
  }

  if (normalized.kind === 'toolCalls') {
    const toolNames = Array.from(new Set(normalized.calls.map((call: ToolCall) => call.name)))
    return {
      phase: 'llm_call_end',
      callIndex,
      iteration: callIndex,
      model,
      result: 'tool_calls',
      toolNames,
      durationMs,
      summary:
        toolNames.length > 0
          ? `Tool calls requested: ${toolNames.join(', ')}`
          : 'Tool calls requested.',
    }
  }

  return {
    phase: 'llm_call_end',
    callIndex,
    iteration: callIndex,
    model,
    result: 'error',
    durationMs,
    summary: 'Model response invalid.',
  }
}

type ToolRegistryResult = { ok: true; value: AgentTool[] } | { ok: false; error: ExecutorError }

const resolveToolExecutors = (tools?: AgentTool[]): ToolRegistryResult => {
  if (!tools || tools.length === 0) {
    return { ok: true, value: ALL_TOOLS }
  }

  const provided = tools.map((tool) => tool.name).sort()
  const expected = ALL_TOOLS.map((tool) => tool.name).sort()
  const matches =
    provided.length === expected.length && provided.every((name, index) => name === expected[index])
  if (!matches) {
    return {
      ok: false,
      error: {
        code: 'TOOL_REGISTRY_INVALID',
        message: 'Executor tools must match ALL_TOOLS registry.',
      },
    }
  }

  return { ok: true, value: tools }
}

export const validateToolRegistry = (tools: AgentTool[]): ExecutorError | null => {
  const seen = new Set<string>()
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]
    if (!tool) {
      return {
        code: 'TOOL_REGISTRY_INVALID',
        message: `Tool at index ${index} is missing.`,
      }
    }
    const name = tool.name.trim()
    if (!name) {
      return {
        code: 'TOOL_REGISTRY_INVALID',
        message: `Tool at index ${index} is missing a name.`,
      }
    }
    if (seen.has(name)) {
      return {
        code: 'TOOL_REGISTRY_INVALID',
        message: `Tool name "${name}" is duplicated in registry.`,
      }
    }
    seen.add(name)

    if (!tool.description || !tool.description.trim()) {
      return {
        code: 'TOOL_REGISTRY_INVALID',
        message: `Tool "${name}" is missing a description.`,
      }
    }

    if (!isRecord(tool.inputSchema)) {
      return {
        code: 'TOOL_REGISTRY_INVALID',
        message: `Tool "${name}" inputSchema must be an object.`,
      }
    }
  }
  return null
}

export const normalizeLLMResult = (result: LLMResult): NormalizedLLMResponse => {
  const parsed = parseToolCallsFromResult(result)
  if (parsed) {
    if (!parsed.ok) {
      return { kind: 'toolCallError', error: parsed.error, source: null }
    }
    return { kind: 'toolCalls', calls: parsed.value.calls, source: parsed.value.source }
  }

  const text = typeof result.content === 'string' ? result.content.trim() : ''
  if (text) {
    return { kind: 'finalText', text }
  }

  return { kind: 'responseError', message: 'LLM response did not include content or tool calls.' }
}

const extractAssistantText = (result: LLMResult): string | null => {
  if (typeof result.content !== 'string') {
    return null
  }
  const trimmed = result.content.trim()
  return trimmed.length > 0 ? trimmed : null
}

const truncateBestKnownText = (value: string): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= BEST_KNOWN_TEXT_MAX) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, BEST_KNOWN_TEXT_MAX - 3))}...`
}

const validateToolCalls = (
  toolCalls: ToolCall[],
  toolMap: Map<string, AgentTool>,
): { ok: true; value: ToolCall[] } | { ok: false; error: ExecutorError } => {
  const normalized: ToolCall[] = []

  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index]
    const name = call?.name?.trim()
    if (!name) {
      return {
        ok: false,
        error: {
          code: 'TOOL_CALL_VALIDATION_ERROR',
          message: 'Tool call is missing a name.',
          details: { callIndex: index + 1 },
        },
      }
    }

    const tool = toolMap.get(name)
    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'TOOL_CALL_VALIDATION_ERROR',
          message: `Tool call references unknown tool "${name}".`,
          details: { toolName: name, callIndex: index + 1 },
        },
      }
    }

    const normalizedArgs = normalizeToolArguments(call?.arguments, name)
    if (!normalizedArgs.ok) {
      return normalizedArgs
    }

    if (expectsObjectArguments(tool.inputSchema) && !isRecord(normalizedArgs.value)) {
      return {
        ok: false,
        error: {
          code: 'TOOL_CALL_VALIDATION_ERROR',
          message: `Tool call arguments for "${name}" must be an object to match schema.`,
          details: { toolName: name, callIndex: index + 1 },
        },
      }
    }

    normalized.push({
      id: call?.id ?? `tool_call_${index + 1}`,
      name,
      arguments: normalizedArgs.value,
    })
  }

  return { ok: true, value: normalized }
}

const normalizeToolArguments = (
  value: unknown,
  toolName: string,
): { ok: true; value: unknown } | { ok: false; error: ExecutorError } => {
  if (value === undefined) {
    return { ok: true, value: {} }
  }

  if (typeof value === 'string') {
    try {
      return { ok: true, value: JSON.parse(value) }
    } catch {
      return {
        ok: false,
        error: {
          code: 'TOOL_CALL_VALIDATION_ERROR',
          message: `Tool call arguments for "${toolName}" must be valid JSON.`,
          details: { toolName },
        },
      }
    }
  }

  return { ok: true, value }
}

const buildExecutionPlans = (
  toolCalls: ToolCall[],
  toolMap: Map<string, AgentTool>,
): { ok: true; value: ToolExecutionPlan[] } | { ok: false; error: ExecutorError } => {
  const plans: ToolExecutionPlan[] = []

  for (const call of toolCalls) {
    const tool = toolMap.get(call.name)
    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'TOOL_PLAN_ERROR',
          message: `Tool "${call.name}" is not registered for planning.`,
          details: { toolName: call.name },
        },
      }
    }
    const plan = buildToolExecutionPlan(call, tool)
    if (!plan.ok) {
      return {
        ok: false,
        error: {
          code: 'TOOL_PLAN_ERROR',
          message: plan.error.message,
          details: { toolName: call.name, planCode: plan.error.code },
        },
      }
    }
    plans.push(plan.value)
  }

  return { ok: true, value: plans }
}

const expectsObjectArguments = (schema: ToolDefinition['inputSchema']): boolean => {
  if (!isRecord(schema)) {
    return false
  }
  const type = typeof schema.type === 'string' ? schema.type : undefined
  if (type === 'object') {
    return true
  }
  return 'properties' in schema
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
