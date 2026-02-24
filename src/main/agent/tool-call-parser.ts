import type { LLMResult, ToolCall } from '@prompt-maker/core'

export type ToolCallSource = 'llm_tool_calls' | 'content_json' | 'content_text'

export type ToolCallParseErrorCode =
  | 'INVALID_JSON'
  | 'MISSING_TOOL_NAME'
  | 'INVALID_ARGUMENTS_JSON'
  | 'UNSUPPORTED_SHAPE'
  | 'EMPTY_TOOL_CALLS'

export type ToolCallParseError = {
  code: ToolCallParseErrorCode
  message: string
  details?: { index?: number }
}

export type ToolCallParseResult =
  | { ok: true; value: { calls: ToolCall[]; source: ToolCallSource } }
  | { ok: false; error: ToolCallParseError }

type ToolCallListResult = { ok: true; value: ToolCall[] } | { ok: false; error: ToolCallParseError }

export const parseToolCallsFromResult = (result: LLMResult): ToolCallParseResult | null => {
  const toolCalls = result.toolCalls
  if (toolCalls && toolCalls.length > 0) {
    return { ok: true, value: { calls: toolCalls, source: 'llm_tool_calls' } }
  }

  const content = result.content
  if (typeof content !== 'string') {
    return null
  }

  return parseToolCallsFromContent(content)
}

export const parseToolCallsFromContent = (content: string): ToolCallParseResult | null => {
  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  const fenced = extractFencedJson(trimmed)
  if (fenced) {
    const parsed = safeParseJson(fenced)
    if (parsed.ok) {
      const container = parseToolCallContainer(parsed.value, 'content_json')
      if (container) {
        return container
      }
    }
  }

  const candidate = extractJsonCandidate(trimmed)
  if (candidate) {
    const parsedCandidate = safeParseJson(candidate)
    if (parsedCandidate.ok) {
      const container = parseToolCallContainer(parsedCandidate.value, 'content_text')
      if (container) {
        return container
      }
    }
  }

  return null
}

const parseToolCallContainer = (
  value: unknown,
  source: ToolCallSource,
): ToolCallParseResult | null => {
  if (!isRecord(value) && !Array.isArray(value)) {
    return null
  }

  const calls = Array.isArray(value)
    ? extractToolCallsFromArray(value)
    : extractToolCallsFromRecord(value)

  if (calls === null) {
    return null
  }

  if (!calls.ok) {
    return calls
  }

  if (calls.value.length === 0) {
    return {
      ok: false,
      error: { code: 'EMPTY_TOOL_CALLS', message: 'Tool call list is empty.' },
    }
  }

  return { ok: true, value: { calls: calls.value, source } }
}

const extractToolCallsFromRecord = (record: Record<string, unknown>): ToolCallListResult | null => {
  const arrayValue = getArray(record, ['toolCalls', 'tool_calls', 'calls'])
  if (arrayValue) {
    return extractToolCallsFromArray(arrayValue)
  }

  if (!looksLikeToolCallRecord(record)) {
    return null
  }

  const call = parseToolCallRecord(record, 0)
  if (!call.ok) {
    return call
  }

  return { ok: true, value: [call.value] }
}

const extractToolCallsFromArray = (value: unknown[]): ToolCallListResult | null => {
  const calls: ToolCall[] = []

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index]
    if (!isRecord(entry)) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_SHAPE', message: 'Tool call entry must be an object.' },
      }
    }
    const parsed = parseToolCallRecord(entry, index)
    if (!parsed.ok) {
      return parsed
    }
    calls.push(parsed.value)
  }

  return { ok: true, value: calls }
}

const parseToolCallRecord = (
  record: Record<string, unknown>,
  index: number,
): { ok: true; value: ToolCall } | { ok: false; error: ToolCallParseError } => {
  const name = resolveToolName(record)
  if (!name) {
    return {
      ok: false,
      error: {
        code: 'MISSING_TOOL_NAME',
        message: 'Tool call is missing a name.',
        ...(index >= 0 ? { details: { index } } : {}),
      },
    }
  }

  const argsValue = resolveToolArguments(record)
  const argumentsValue = normalizeArguments(argsValue, name, index)
  if (!argumentsValue.ok) {
    return argumentsValue
  }

  const id = resolveToolCallId(record)

  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      name,
      arguments: argumentsValue.value,
    },
  }
}

const normalizeArguments = (
  value: unknown,
  toolName: string,
  index: number,
): { ok: true; value: unknown } | { ok: false; error: ToolCallParseError } => {
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
          code: 'INVALID_ARGUMENTS_JSON',
          message: `Tool call arguments for "${toolName}" must be valid JSON.`,
          details: { index },
        },
      }
    }
  }

  return { ok: true, value }
}

const resolveToolName = (record: Record<string, unknown>): string | null => {
  const candidates = [record.name, record.tool, record.toolName]
  const functionRecord = isRecord(record.function) ? record.function : null
  candidates.push(functionRecord?.name)

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

const resolveToolArguments = (record: Record<string, unknown>): unknown => {
  const functionRecord = isRecord(record.function) ? record.function : null
  return (
    record.arguments ??
    record.args ??
    record.parameters ??
    record.input ??
    functionRecord?.arguments
  )
}

const resolveToolCallId = (record: Record<string, unknown>): string | undefined => {
  const candidates = [record.id, record.callId, record.toolCallId]
  const functionRecord = isRecord(record.function) ? record.function : null
  candidates.push(functionRecord?.id)

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return undefined
}

const looksLikeToolCallRecord = (record: Record<string, unknown>): boolean => {
  return (
    'tool' in record ||
    'toolName' in record ||
    'name' in record ||
    'arguments' in record ||
    'args' in record ||
    'function' in record
  )
}

const extractFencedJson = (text: string): string | null => {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }
  const generic = text.match(/```\s*([\s\S]*?)```/i)
  return generic?.[1] ? generic[1].trim() : null
}

const extractJsonCandidate = (text: string): string | null => {
  const objectCandidate = extractFirstBalanced(text, '{', '}')
  if (objectCandidate) {
    return objectCandidate
  }
  return extractFirstBalanced(text, '[', ']')
}

const extractFirstBalanced = (text: string, open: string, close: string): string | null => {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (!char) {
      continue
    }
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === open) {
      if (depth === 0) {
        start = i
      }
      depth += 1
      continue
    }

    if (char === close && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1)
      }
    }
  }

  return null
}

const safeParseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

const getArray = (record: Record<string, unknown>, keys: string[]): unknown[] | null => {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
