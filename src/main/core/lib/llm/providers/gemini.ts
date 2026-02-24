import { z } from 'zod'

import type {
  JsonSchema,
  LLMResult,
  Message,
  ToolCall,
  ToolCallRequest,
  ToolDefinition,
} from '../types'
import { toGeminiParts, type GeminiContentPart } from '../message-adapters'

export type GeminiApiVersion = 'v1' | 'v1beta'

type GeminiFunctionResponsePart = {
  functionResponse: {
    name: string
    response: Record<string, unknown>
  }
}

type GeminiRequestPart = GeminiContentPart | GeminiFunctionResponsePart

type GeminiContent = {
  role: 'user' | 'model' | 'system'
  parts: GeminiRequestPart[]
}

type GeminiFunctionDeclaration = {
  name: string
  description?: string
  parameters: JsonSchema
}

type GeminiTool = {
  functionDeclarations: GeminiFunctionDeclaration[]
}

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z
                  .object({
                    text: z.string().optional(),
                    inlineData: z
                      .object({
                        mimeType: z.string(),
                        data: z.string(),
                      })
                      .optional(),
                    fileData: z
                      .object({
                        mimeType: z.string(),
                        fileUri: z.string(),
                      })
                      .optional(),
                    functionCall: z
                      .object({
                        name: z.string().optional(),
                        args: z.unknown().optional(),
                      })
                      .passthrough()
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
})

type GeminiResponse = z.infer<typeof GeminiResponseSchema>

type GeminiRequestBody = {
  contents: GeminiContent[]
  systemInstruction?: GeminiContent
  generationConfig: { temperature: number }
  tools?: GeminiTool[]
}

const GeminiEmbeddingResponseSchema = z.object({
  embedding: z
    .object({
      value: z.array(z.number()).optional(),
    })
    .optional(),
})

const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

const normalizeGeminiBaseUrl = (value: string | undefined): string => {
  const trimmed = value?.trim()
  const candidate = trimmed && trimmed.length > 0 ? trimmed : DEFAULT_GEMINI_BASE_URL
  const withoutTrailingSlash = candidate.replace(/\/$/, '')

  const suffixes = ['/v1beta/models', '/v1/models', '/v1beta', '/v1']
  const stripped = suffixes.reduce((current, suffix) => {
    return current.endsWith(suffix) ? current.slice(0, -suffix.length) : current
  }, withoutTrailingSlash)

  return stripped || DEFAULT_GEMINI_BASE_URL
}

const GEMINI_BASE_URL = normalizeGeminiBaseUrl(process.env.GEMINI_BASE_URL)
export const normalizeGeminiApiVersion = (value: string): GeminiApiVersion => {
  const trimmed = value.trim().toLowerCase()
  return trimmed === 'v1beta' ? 'v1beta' : 'v1'
}

const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION?.trim() || 'v1beta'
const GEMINI_API_VERSION_NORMALIZED = normalizeGeminiApiVersion(GEMINI_API_VERSION)

const parseJsonWithSchema = async <T>(
  response: Response,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  label: string,
): Promise<T> => {
  const payload = (await response.json()) as unknown
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`${label} response schema mismatch: ${parsed.error.message}`)
  }
  return parsed.data
}

type GeminiCallFailure = {
  ok: false
  status: number
  details: string
  apiVersion: GeminiApiVersion
}

type GeminiCallResult = { ok: true; result: LLMResult } | GeminiCallFailure

const callGeminiOnce = async (
  messages: Message[],
  model: string,
  apiKey: string,
  apiVersion: GeminiApiVersion,
  tools?: ToolDefinition[],
): Promise<GeminiCallResult> => {
  const endpointBase = GEMINI_BASE_URL
  const normalizedVersion = normalizeGeminiApiVersion(apiVersion)
  const url = `${endpointBase}/${normalizedVersion}/models/${model}:generateContent?key=${apiKey}`
  const body = buildGeminiRequestBody(messages, tools)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    return { ok: false, status: response.status, details, apiVersion: normalizedVersion }
  }

  const data = await parseJsonWithSchema(response, GeminiResponseSchema, 'Gemini generate')
  const content = extractGeminiText(data)
  const toolCalls = extractGeminiToolCalls(data)

  if (!content && toolCalls.length === 0) {
    const finishReason = data.candidates?.[0]?.finishReason
    if (finishReason && finishReason !== 'STOP') {
      throw new Error(`Gemini API blocked the response. Reason: ${finishReason}`)
    }
    throw new Error('Gemini response did not include text content. (API returned empty STOP)')
  }

  return {
    ok: true,
    result: {
      content: content ?? null,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
  }
}

const messageHasGeminiFileParts = (content: Message['content']): boolean => {
  return typeof content !== 'string' && content.some((part) => 'fileUri' in part)
}

const requestHasGeminiFileParts = (messages: Message[]): boolean => {
  return messages.some((message) => messageHasGeminiFileParts(message.content))
}

const shouldRetryGeminiApiVersion = (status: number): boolean => {
  return status === 404
}

export const callGemini = async (
  messages: Message[],
  model: string,
  tools?: ToolDefinition[],
): Promise<LLMResult> => {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY env var is not set.')
  }

  const wantsFileParts = requestHasGeminiFileParts(messages)
  const envVersion = GEMINI_API_VERSION_NORMALIZED

  const primaryVersion: GeminiApiVersion = wantsFileParts ? 'v1beta' : envVersion

  const primary = await callGeminiOnce(messages, model, apiKey, primaryVersion, tools)
  if (primary.ok) {
    return primary.result
  }

  if (shouldRetryGeminiApiVersion(primary.status)) {
    const fallbackVersion: GeminiApiVersion = primaryVersion === 'v1beta' ? 'v1' : 'v1beta'
    const fallback = await callGeminiOnce(messages, model, apiKey, fallbackVersion, tools)
    if (fallback.ok) {
      return fallback.result
    }

    throw new Error(
      `Gemini (${fallback.apiVersion}) request failed with status ${fallback.status}: ${fallback.details}\n` +
        `Tried ${primary.apiVersion} first: ${primary.details}`,
    )
  }

  throw new Error(
    `Gemini (${primary.apiVersion}) request failed with status ${primary.status}: ${primary.details}`,
  )
}

const buildGeminiRequestBody = (
  messages: Message[],
  tools?: ToolDefinition[],
): GeminiRequestBody => {
  const systemMessages = messages.filter((message) => message.role === 'system')

  const toolCallNameById = buildToolCallNameLookup(messages)
  const contents: GeminiContent[] = messages
    .filter((message) => message.role !== 'system')
    .map((message) => toGeminiContent(message, toolCallNameById))

  if (contents.length === 0) {
    throw new Error('Gemini requests require at least one user message.')
  }

  const payload: GeminiRequestBody = {
    contents,
    generationConfig: { temperature: 0.2 },
  }

  const geminiTools = toGeminiTools(tools)
  if (geminiTools) {
    payload.tools = geminiTools
  }

  const systemParts = systemMessages.flatMap((message) => toGeminiParts(message.content))

  if (systemParts.length > 0) {
    payload.systemInstruction = {
      role: 'system',
      parts: systemParts,
    }
  }

  return payload
}

const extractGeminiText = (response: GeminiResponse): string | null => {
  const firstCandidate = response.candidates?.[0]
  const parts = firstCandidate?.content?.parts ?? []
  const text = parts
    .map((part) => ('text' in part ? (part.text ?? '') : ''))
    .join('')
    .trim()

  return text || null
}

const toGeminiContent = (
  message: Message,
  toolCallNameById: Map<string, string>,
): GeminiContent => {
  if (message.role === 'tool') {
    const toolCallId = resolveToolCallIdForToolMessage(message)
    const toolName = resolveGeminiToolNameForToolCall(toolCallId, toolCallNameById)
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: buildGeminiToolResponsePayload(message.content, toolCallId),
          },
        },
      ],
    }
  }

  const role = message.role === 'user' ? 'user' : 'model'
  const parts = toGeminiParts(message.content)
  if (parts.length === 0) {
    parts.push({ text: '' })
  }
  return {
    role,
    parts,
  }
}

const buildGeminiToolResponsePayload = (
  content: Message['content'],
  toolCallId: string,
): Record<string, unknown> => {
  const textContent = serializeGeminiToolResponseContent(content)

  try {
    const parsed = JSON.parse(textContent)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through if it's just raw text.
  }

  void toolCallId

  return { result: textContent }
}

const serializeGeminiToolResponseContent = (content: Message['content']): string => {
  if (typeof content === 'string') {
    return content
  }

  return content.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

const resolveToolCallIdForToolMessage = (message: Message): string => {
  const toolCallId = coerceNonEmptyString(message.toolCallId ?? message.tool_call_id)
  if (!toolCallId) {
    throw new Error('Tool messages require toolCallId for tool call correlation.')
  }

  return toolCallId
}

const resolveGeminiToolNameForToolCall = (
  toolCallId: string,
  toolCallNameById: Map<string, string>,
): string => {
  const mapped = toolCallNameById.get(toolCallId)
  if (mapped) {
    return mapped
  }

  const parsed = parseGeminiToolNameFromCallId(toolCallId)
  if (parsed) {
    return parsed
  }

  throw new Error(
    `Gemini tool messages require a tool name for toolCallId "${toolCallId}". ` +
      'Provide matching toolCalls or use gemini_<name>_<index> ids.',
  )
}

const parseGeminiToolNameFromCallId = (toolCallId: string): string | null => {
  const prefix = 'gemini_'
  if (!toolCallId.startsWith(prefix)) {
    return null
  }

  const withoutPrefix = toolCallId.slice(prefix.length)
  const lastUnderscore = withoutPrefix.lastIndexOf('_')
  if (lastUnderscore <= 0) {
    return null
  }

  return withoutPrefix.slice(0, lastUnderscore)
}

const buildToolCallNameLookup = (messages: Message[]): Map<string, string> => {
  const mapping = new Map<string, string>()

  for (const message of messages) {
    const toolCalls = message.toolCalls ?? message.tool_calls
    if (!toolCalls) {
      continue
    }
    toolCalls.forEach((call, index) => {
      const name = resolveToolCallRequestName(call)
      const id = resolveToolCallRequestId(call, index)
      if (name && id) {
        mapping.set(id, name)
      }
    })
  }

  return mapping
}

const resolveToolCallRequestName = (call: ToolCallRequest): string | null => {
  if ('function' in call && call.function?.name) {
    return call.function.name
  }

  if ('name' in call && typeof call.name === 'string') {
    return call.name
  }

  return null
}

const resolveToolCallRequestId = (call: ToolCallRequest, index: number): string | null => {
  if ('id' in call) {
    const id = coerceNonEmptyString(call.id)
    if (id) {
      return id
    }
  }

  const name = resolveToolCallRequestName(call)
  if (!name) {
    return null
  }

  return `tool_call_${index + 1}`
}

const extractGeminiToolCalls = (response: GeminiResponse): ToolCall[] => {
  const firstCandidate = response.candidates?.[0]
  const parts = firstCandidate?.content?.parts ?? []
  const toolCalls: ToolCall[] = []

  for (const part of parts) {
    if (!('functionCall' in part)) {
      continue
    }
    const functionCall = part.functionCall
    if (!functionCall || typeof functionCall.name !== 'string' || !functionCall.name) {
      continue
    }
    const id = resolveGeminiToolCallId(functionCall, functionCall.name, toolCalls.length)

    toolCalls.push({
      id,
      name: functionCall.name,
      arguments: parseGeminiArguments(functionCall.args),
    })
  }

  return toolCalls
}

const DEFAULT_GEMINI_PARAMETERS: JsonSchema = { type: 'object', properties: {} }

const toGeminiTools = (tools: ToolDefinition[] | undefined): GeminiTool[] | null => {
  if (!tools || tools.length === 0) {
    return null
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: resolveGeminiToolParameters(tool.inputSchema),
      })),
    },
  ]
}

const resolveGeminiToolParameters = (inputSchema: JsonSchema | undefined): JsonSchema => {
  if (!inputSchema || typeof inputSchema !== 'object') {
    return DEFAULT_GEMINI_PARAMETERS
  }

  const normalized: JsonSchema =
    !inputSchema.type && inputSchema.properties
      ? { ...inputSchema, type: 'object' as const }
      : inputSchema

  return sanitizeGeminiSchema(normalized)
}

const sanitizeGeminiSchema = (schema: JsonSchema): JsonSchema => {
  const {
    additionalProperties: _additionalProperties,
    properties,
    items,
    anyOf,
    oneOf,
    allOf,
    ...rest
  } = schema
  const next: JsonSchema = { ...rest }

  if (properties) {
    const nextProperties: Record<string, JsonSchema> = {}
    for (const [key, value] of Object.entries(properties)) {
      nextProperties[key] = sanitizeGeminiSchema(value)
    }
    next.properties = nextProperties
  }

  if (items) {
    next.items = Array.isArray(items)
      ? items.map((item) => sanitizeGeminiSchema(item))
      : sanitizeGeminiSchema(items)
  }

  if (anyOf) {
    next.anyOf = anyOf.map((entry) => sanitizeGeminiSchema(entry))
  }

  if (oneOf) {
    next.oneOf = oneOf.map((entry) => sanitizeGeminiSchema(entry))
  }

  if (allOf) {
    next.allOf = allOf.map((entry) => sanitizeGeminiSchema(entry))
  }

  return next
}

const resolveGeminiToolCallId = (functionCall: unknown, name: string, index: number): string => {
  if (isRecord(functionCall)) {
    const direct = coerceNonEmptyString(functionCall.id)
    if (direct) return direct

    const callId = coerceNonEmptyString(functionCall.callId)
    if (callId) return callId

    const toolCallId = coerceNonEmptyString(functionCall.toolCallId)
    if (toolCallId) return toolCallId
  }

  return `gemini_${name}_${index + 1}`
}

const parseGeminiArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const coerceNonEmptyString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null
}

export const callGeminiEmbedding = async (text: string, model: string): Promise<number[]> => {
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY env var is not set.')
  }

  const endpointBase = GEMINI_BASE_URL
  const url = `${endpointBase}/${GEMINI_API_VERSION_NORMALIZED}/models/${model}:embedContent?key=${apiKey}`
  const body = {
    content: {
      parts: [{ text }],
    },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Gemini embedding request failed with status ${response.status}: ${details}`)
  }

  const data = await parseJsonWithSchema(response, GeminiEmbeddingResponseSchema, 'Gemini embed')
  const embedding = data.embedding?.value

  if (!embedding) {
    throw new Error('Gemini embedding response did not include embedding values.')
  }

  return embedding
}
