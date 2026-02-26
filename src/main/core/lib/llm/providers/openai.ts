import { z } from 'zod'

import type { JsonSchema, LLMResult, Message, ToolCall, ToolDefinition } from '../types'
import type { OpenAIChatCompletionMessage, OpenAIResponsesInputMessage } from '../message-adapters'
import { toOpenAIMessageAsync, toOpenAIResponsesInputMessageAsync } from '../message-adapters'

const OpenAIToolCallSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    function: z
      .object({
        name: z.string().optional(),
        arguments: z.string().optional()
      })
      .optional(),
    name: z.string().optional(),
    arguments: z.string().optional()
  })
  .passthrough()

const OpenAIChatCompletionResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z
        .object({
          content: z.union([
            z.string(),
            z.array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional()
                })
                .passthrough()
            ),
            z.null()
          ]),
          tool_calls: z.array(OpenAIToolCallSchema).optional(),
          function_call: OpenAIToolCallSchema.optional()
        })
        .passthrough()
    })
  )
})

const OpenAIEmbeddingResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()) }))
})

type OpenAIResponsesOutputText = { type: 'output_text'; text?: string }

type OpenAIResponsesOutputMessage = {
  type: 'message'
  role?: 'assistant' | 'user' | 'developer'
  content?: OpenAIResponsesOutputText[]
}

const OpenAIResponsesResponseSchema = z
  .object({
    output_text: z.string().optional(),
    output: z
      .array(
        z.union([
          z.object({
            type: z.literal('message'),
            role: z.enum(['assistant', 'user', 'developer']).optional(),
            content: z
              .array(
                z
                  .object({
                    type: z.string().optional(),
                    text: z.string().optional()
                  })
                  .passthrough()
              )
              .optional()
          }),
          z.object({}).passthrough()
        ])
      )
      .optional()
  })
  .passthrough()

type OpenAIResponsesResponse = z.infer<typeof OpenAIResponsesResponseSchema>

const rawOpenAiBase = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const OPENAI_BASE_URL = rawOpenAiBase
  .replace(/\/$/, '')
  .replace(/\/completions$/, '')
  .replace(/\/chat\/completions$/, '')

const OPENAI_CHAT_ENDPOINT = `${OPENAI_BASE_URL}/chat/completions`
const OPENAI_RESPONSES_ENDPOINT = `${OPENAI_BASE_URL}/responses`
const OPENAI_EMBEDDING_ENDPOINT = `${OPENAI_BASE_URL}/embeddings`

const shouldUseChatCompletions = (model: string): boolean => {
  const m = model.trim().toLowerCase()

  if (m.startsWith('gpt-5')) {
    return false
  }

  if (m.includes('codex')) {
    return false
  }

  if (m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) {
    return false
  }

  return true
}

const toErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string') return maybeMessage
  }
  return ''
}

const isOpenAIEndpointMismatchError = (error: unknown): boolean => {
  const text = toErrorMessage(error).toLowerCase()
  if (!text) return false

  const mentionsChat = text.includes('/chat/completions') || text.includes('chat/completions')
  const mentionsResponses =
    text.includes('/responses') || text.includes('v1/responses') || text.includes('responses api')

  return mentionsChat && mentionsResponses
}

export const callOpenAI = async (
  messages: Message[],
  model: string,
  tools?: ToolDefinition[]
): Promise<LLMResult> => {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY env var is not set.')
  }

  const preferChat = shouldUseChatCompletions(model)

  try {
    return preferChat
      ? await callOpenAIChatCompletions(messages, model, apiKey, tools)
      : await callOpenAIResponses(messages, model, apiKey, tools)
  } catch (error: unknown) {
    if (!isOpenAIEndpointMismatchError(error)) {
      throw error
    }

    return preferChat
      ? await callOpenAIResponses(messages, model, apiKey, tools)
      : await callOpenAIChatCompletions(messages, model, apiKey, tools)
  }
}

const parseJsonWithSchema = async <T>(
  response: Response,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  label: string
): Promise<T> => {
  const payload = (await response.json()) as unknown
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`${label} response schema mismatch: ${parsed.error.message}`)
  }
  return parsed.data
}

const callOpenAIChatCompletions = async (
  messages: Message[],
  model: string,
  apiKey: string,
  tools?: ToolDefinition[]
): Promise<LLMResult> => {
  const payloadMessages: OpenAIChatCompletionMessage[] = await Promise.all(
    messages.map(toOpenAIMessageAsync)
  )
  const openAiTools = toOpenAIChatTools(tools)

  const response = await fetch(OPENAI_CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: payloadMessages,
      ...(openAiTools ? { tools: openAiTools } : {})
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI request failed with status ${response.status}: ${details}`)
  }

  const data = await parseJsonWithSchema(
    response,
    OpenAIChatCompletionResponseSchema,
    'OpenAI chat completion'
  )
  const rawMessage = data.choices?.[0]?.message
  const rawContent = rawMessage?.content
  const content =
    typeof rawContent === 'string'
      ? rawContent.trim()
      : rawContent
        ? rawContent
            .map((part) => part.text ?? '')
            .join('')
            .trim()
        : ''
  const toolCalls: ToolCall[] = []
  appendNormalizedToolCalls(toolCalls, rawMessage?.tool_calls)
  appendNormalizedToolCall(toolCalls, rawMessage?.function_call)

  if (!content && toolCalls.length === 0) {
    throw new Error('OpenAI response did not include assistant content.')
  }

  return {
    content: content.length > 0 ? content : null,
    ...(toolCalls.length > 0 ? { toolCalls } : {})
  }
}

const callOpenAIResponses = async (
  messages: Message[],
  model: string,
  apiKey: string,
  tools?: ToolDefinition[]
): Promise<LLMResult> => {
  const input: OpenAIResponsesInputMessage[] = await Promise.all(
    messages.map(toOpenAIResponsesInputMessageAsync)
  )
  const openAiTools = toOpenAIResponsesTools(tools)

  const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input,
      ...(openAiTools ? { tools: openAiTools } : {})
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI request failed with status ${response.status}: ${details}`)
  }

  const data = await parseJsonWithSchema(
    response,
    OpenAIResponsesResponseSchema,
    'OpenAI responses'
  )
  const content = extractOpenAIResponsesText(data)
  const toolCalls = extractOpenAIResponsesToolCalls(data)

  if (!content && toolCalls.length === 0) {
    throw new Error('OpenAI response did not include assistant content.')
  }

  return {
    content: content ?? null,
    ...(toolCalls.length > 0 ? { toolCalls } : {})
  }
}

const extractOpenAIResponsesText = (response: OpenAIResponsesResponse): string | null => {
  const direct = response.output_text?.trim()
  if (direct && direct.length > 0) return direct

  const output = response.output ?? []
  const assistantMessages = output.filter(
    (item): item is OpenAIResponsesOutputMessage =>
      item.type === 'message' && item.role === 'assistant'
  )

  const text = assistantMessages
    .flatMap((msg) => msg.content ?? [])
    .filter((part): part is OpenAIResponsesOutputText => part.type === 'output_text')
    .map((part) => (part.text ?? '').toString())
    .join('')
    .trim()

  return text.length > 0 ? text : null
}

const extractOpenAIResponsesToolCalls = (response: OpenAIResponsesResponse): ToolCall[] => {
  const output = response.output ?? []
  const toolCalls: ToolCall[] = []

  for (const item of output) {
    if (!isRecord(item)) continue

    const record = item as Record<string, unknown>
    appendNormalizedToolCalls(toolCalls, record.tool_calls)
    appendNormalizedToolCall(toolCalls, record.function_call)

    const type = typeof record.type === 'string' ? record.type : ''
    if (type === 'tool_call' || type === 'function_call' || type === 'tool') {
      const call = normalizeOpenAIToolCall(record, toolCalls.length)
      if (call) {
        toolCalls.push(call)
      }
    }

    const content = record.content
    if (Array.isArray(content)) {
      for (const part of content) {
        const call = normalizeOpenAIToolCall(part, toolCalls.length)
        if (call) {
          toolCalls.push(call)
        }
      }
    }
  }

  return toolCalls
}

const appendNormalizedToolCalls = (target: ToolCall[], raw: unknown): void => {
  if (!Array.isArray(raw)) {
    return
  }

  const offset = target.length
  raw.forEach((call, index) => {
    const normalized = normalizeOpenAIToolCall(call, offset + index)
    if (normalized) {
      target.push(normalized)
    }
  })
}

const appendNormalizedToolCall = (target: ToolCall[], raw: unknown): void => {
  const normalized = normalizeOpenAIToolCall(raw, target.length)
  if (normalized) {
    target.push(normalized)
  }
}

const normalizeOpenAIToolCall = (value: unknown, fallbackIndex?: number): ToolCall | null => {
  if (!isRecord(value)) {
    return null
  }

  const id = resolveToolCallId(value.id, fallbackIndex)

  if (isRecord(value.function)) {
    const name = typeof value.function.name === 'string' ? value.function.name : undefined
    if (!name) {
      return null
    }
    const args = value.function.arguments
    return {
      ...(id ? { id } : {}),
      name,
      arguments: parseToolArguments(args)
    }
  }

  const name = typeof value.name === 'string' ? value.name : undefined
  if (!name) {
    return null
  }

  return {
    ...(id ? { id } : {}),
    name,
    arguments: parseToolArguments(value.arguments)
  }
}

const resolveToolCallId = (value: unknown, fallbackIndex?: number): string | undefined => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  if (typeof fallbackIndex === 'number') {
    return `call_${fallbackIndex + 1}`
  }
  return undefined
}

const parseToolArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const DEFAULT_TOOL_PARAMETERS: JsonSchema = { type: 'object', properties: {} }

const toOpenAIChatTools = (
  tools: ToolDefinition[] | undefined
): Array<{
  type: 'function'
  function: { name: string; description?: string; parameters: JsonSchema }
}> | null => {
  if (!tools || tools.length === 0) {
    return null
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: resolveToolParameters(tool.inputSchema)
    }
  }))
}

const toOpenAIResponsesTools = (
  tools: ToolDefinition[] | undefined
): Array<{
  type: 'function'
  name: string
  description?: string
  parameters: JsonSchema
}> | null => {
  if (!tools || tools.length === 0) {
    return null
  }

  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: resolveToolParameters(tool.inputSchema)
  }))
}

const resolveToolParameters = (inputSchema: JsonSchema | undefined): JsonSchema => {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return DEFAULT_TOOL_PARAMETERS
  }

  return inputSchema
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const callOpenAIEmbedding = async (text: string, model: string): Promise<number[]> => {
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY env var is not set.')
  }

  const response = await fetch(OPENAI_EMBEDDING_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input: text })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`OpenAI embedding request failed with status ${response.status}: ${details}`)
  }

  const data = await parseJsonWithSchema(
    response,
    OpenAIEmbeddingResponseSchema,
    'OpenAI embedding'
  )
  const embedding = data.data?.[0]?.embedding

  if (!embedding) {
    throw new Error('OpenAI embedding response did not include embedding values.')
  }

  return embedding
}
