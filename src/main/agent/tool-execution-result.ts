import type { ToolCall } from '@prompt-maker/core'

export type ToolExecutionIo = {
  stdout?: string
  stderr?: string
  exitCode?: number
}

export type ToolExecutionError = {
  code: string
  message: string
  details?: Record<string, unknown>
}

export type ToolExecutionEnvelope = {
  ok: boolean
  toolName: string
  callId?: string
  output?: unknown
  error?: ToolExecutionError
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
}

export type ToolExecutionEnvelopeInput = {
  call: ToolCall
  output?: unknown
  error?: ToolExecutionError
  io?: ToolExecutionIo
  durationMs?: number
}

const SUMMARY_MAX_LENGTH = 140
const PATH_MAX_LENGTH = 64

export const buildToolExecutionEnvelope = ({
  call,
  output,
  error,
  io,
  durationMs,
}: ToolExecutionEnvelopeInput): ToolExecutionEnvelope => {
  const inferredIo = extractIo(output)
  const mergedIo = mergeIo(inferredIo, io)
  const outputOk = extractOkFlag(output)
  const outputError = outputOk === false ? extractToolError(output) : null

  let ok = error ? false : (outputOk ?? true)
  let normalizedError = error ?? outputError

  if (!normalizedError && outputOk === false) {
    normalizedError = { code: 'TOOL_ERROR', message: 'Tool returned an error.' }
  }

  if (!normalizedError && mergedIo.exitCode !== undefined && mergedIo.exitCode !== 0) {
    ok = false
    normalizedError = {
      code: 'TOOL_NON_ZERO_EXIT',
      message: `Tool exited with code ${mergedIo.exitCode}.`,
      details: { exitCode: mergedIo.exitCode },
    }
  }

  return {
    ok,
    toolName: call.name,
    ...(call.id ? { callId: call.id } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(normalizedError ? { error: normalizedError } : {}),
    ...(mergedIo.stdout ? { stdout: mergedIo.stdout } : {}),
    ...(mergedIo.stderr ? { stderr: mergedIo.stderr } : {}),
    ...(mergedIo.exitCode !== undefined ? { exitCode: mergedIo.exitCode } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

export const serializeToolExecutionEnvelope = (envelope: ToolExecutionEnvelope): string => {
  try {
    return JSON.stringify(envelope)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown serialization error.'
    return JSON.stringify({
      ok: false,
      toolName: envelope.toolName,
      ...(envelope.callId ? { callId: envelope.callId } : {}),
      error: {
        code: 'TOOL_SERIALIZATION_FAILED',
        message,
      },
    })
  }
}

export const summarizeToolExecution = (envelope: ToolExecutionEnvelope): string => {
  if (!envelope.ok) {
    const message = envelope.error?.message ?? 'Tool execution failed.'
    return normalizeSummary(`${envelope.toolName} failed: ${message}`)
  }

  const value = extractToolValue(envelope.output)
  const summary = buildSuccessSummary(envelope.toolName, value)
  return normalizeSummary(summary)
}

const extractOkFlag = (value: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const ok = value.ok
  return typeof ok === 'boolean' ? ok : undefined
}

const extractToolError = (value: unknown): ToolExecutionError | null => {
  if (!isRecord(value)) {
    return null
  }
  const errorValue = value.error
  if (isRecord(errorValue)) {
    const code = typeof errorValue.code === 'string' ? errorValue.code : 'TOOL_ERROR'
    const message =
      typeof errorValue.message === 'string' ? errorValue.message : 'Tool returned an error.'
    const details = isRecord(errorValue.details) ? errorValue.details : undefined
    return {
      code,
      message,
      ...(details ? { details } : {}),
    }
  }
  if (typeof errorValue === 'string') {
    return { code: 'TOOL_ERROR', message: errorValue }
  }
  return null
}

const extractToolValue = (output: unknown): Record<string, unknown> | null => {
  if (!isRecord(output)) {
    return null
  }
  const ok = output.ok
  if (typeof ok === 'boolean' && ok === false) {
    return null
  }
  const value = output.value
  return isRecord(value) ? value : null
}

const extractIo = (value: unknown): ToolExecutionIo => {
  if (!isRecord(value)) {
    return {}
  }
  const stdout = getString(value, 'stdout')
  const stderr = getString(value, 'stderr')
  const exitCode = getNumber(value, 'exitCode') ?? getNumber(value, 'exit_code')
  return {
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
}

const mergeIo = (left: ToolExecutionIo, right?: ToolExecutionIo): ToolExecutionIo => ({
  ...left,
  ...(right ?? {}),
})

const buildSuccessSummary = (toolName: string, value: Record<string, unknown> | null): string => {
  switch (toolName) {
    case 'read_file': {
      const path = formatPath(value?.path)
      const content = typeof value?.content === 'string' ? value.content : null
      const suffix = content ? ` (${content.length} chars)` : ''
      return path ? `Read file ${path}${suffix}` : 'Read file completed'
    }
    case 'list_dir': {
      const path = formatPath(value?.path)
      const entries = Array.isArray(value?.entries) ? value.entries.length : null
      if (path && entries !== null) {
        return `Listed ${entries} entr${entries === 1 ? 'y' : 'ies'} in ${path}`
      }
      return path ? `Listed directory ${path}` : 'Listed directory'
    }
    case 'write_file': {
      const path = formatPath(value?.path)
      const bytes = typeof value?.bytes === 'number' ? value.bytes : null
      if (path && bytes !== null) {
        return `Wrote ${bytes} bytes to ${path}`
      }
      return path ? `Wrote file ${path}` : 'Write file completed'
    }
    case 'search_web': {
      const results = Array.isArray(value?.results) ? value.results.length : null
      const query = typeof value?.query === 'string' ? value.query : null
      if (query && results !== null) {
        return `Search web "${truncate(query, 48)}" (${results} results)`
      }
      return results !== null ? `Search web (${results} results)` : 'Search web completed'
    }
    case 'read_web_page': {
      const sourceUrl = typeof value?.sourceUrl === 'string' ? value.sourceUrl : null
      const markdown = typeof value?.markdown === 'string' ? value.markdown : null
      const suffix = markdown ? ` (${markdown.length} chars)` : ''
      return sourceUrl
        ? `Read web page ${truncate(sourceUrl, PATH_MAX_LENGTH)}${suffix}`
        : 'Read web page completed'
    }
    case 'generate_image': {
      const files = Array.isArray(value?.files) ? value.files.length : null
      const model = typeof value?.model === 'string' ? value.model : null
      if (files !== null) {
        const plural = files === 1 ? '' : 's'
        return model
          ? `Generated ${files} image${plural} (${model})`
          : `Generated ${files} image${plural}`
      }
      return 'Generated image'
    }
    default: {
      return `${toolName} succeeded`
    }
  }
}

const formatPath = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  return truncate(value, PATH_MAX_LENGTH)
}

const truncate = (value: string, maxLength: number): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`
}

const normalizeSummary = (value: string): string => truncate(value, SUMMARY_MAX_LENGTH)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const getNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
