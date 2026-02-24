import type { ToolCall } from '@prompt-maker/core'

import type { AgentTool } from './tools/tool-types'
import { getToolRiskAssessment, type ToolRisk } from './tool-safety'

export type ToolPlanErrorCode = 'ARGUMENTS_NOT_OBJECT'

export type ToolPlanError = {
  code: ToolPlanErrorCode
  message: string
}

export type ToolExecutionPlan = {
  toolName: string
  callId?: string
  args: Record<string, unknown>
  argsSummary: string[]
  summary: string
  risk: ToolRisk
  riskReason?: string
  preflight: string[]
  steps: string[]
  expectedOutputs: string[]
}

export type ToolPlanResult =
  | { ok: true; value: ToolExecutionPlan }
  | { ok: false; error: ToolPlanError }

const EXPECTED_OUTPUTS: Record<string, string[]> = {
  read_file: ['content', 'path', 'encoding'],
  list_dir: ['entries', 'path'],
  write_file: ['path', 'bytes', 'encoding'],
  search_web: ['results', 'engine', 'meta'],
  read_web_page: ['markdown', 'sourceUrl', 'title'],
  generate_image: ['files', 'model', 'createdAt'],
}

const SUMMARY_KEYS: Record<string, string> = {
  read_file: 'path',
  list_dir: 'path',
  write_file: 'path',
  search_web: 'query',
  read_web_page: 'url',
  generate_image: 'prompt',
}

const SUMMARY_LABELS: Record<string, string> = {
  read_file: 'Read file',
  list_dir: 'List directory',
  write_file: 'Write file',
  search_web: 'Search web',
  read_web_page: 'Read web page',
  generate_image: 'Generate image',
}

const MAX_ARG_LINES = 8
const MAX_INLINE_LENGTH = 120
const MAX_PREVIEW_LENGTH = 72
const REDACT_KEYS = new Set(['content'])

export const buildToolExecutionPlan = (call: ToolCall, tool: AgentTool): ToolPlanResult => {
  if (!isRecord(call.arguments)) {
    return {
      ok: false,
      error: {
        code: 'ARGUMENTS_NOT_OBJECT',
        message: `Tool call arguments for "${call.name}" must be an object to build a plan.`,
      },
    }
  }

  const required = Array.isArray(tool.inputSchema.required)
    ? tool.inputSchema.required.filter((entry): entry is string => typeof entry === 'string')
    : []
  const expectedOutputs = EXPECTED_OUTPUTS[call.name] ?? ['result']

  const argsSummary = buildArgsSummary(call.arguments)
  const summary = buildSummary(call.name, call.arguments)
  const riskAssessment = getToolRiskAssessment(call.name)
  const risk = riskAssessment.risk
  const riskReason = riskAssessment.reason

  const preflight = ['Tool registered', 'Arguments validated']
  if (required.length > 0) {
    preflight.push(`Required args: ${required.join(', ')}`)
  }

  const steps = ['Validate inputs', `Execute ${call.name}`, 'Capture tool result']

  return {
    ok: true,
    value: {
      toolName: call.name,
      ...(call.id ? { callId: call.id } : {}),
      args: call.arguments,
      argsSummary,
      summary,
      risk,
      ...(riskReason ? { riskReason } : {}),
      preflight,
      steps,
      expectedOutputs,
    },
  }
}

const buildSummary = (toolName: string, args: Record<string, unknown>): string => {
  const label = SUMMARY_LABELS[toolName] ?? `Run ${toolName}`
  const key = SUMMARY_KEYS[toolName]
  if (!key) {
    return label
  }
  const value = args[key]
  const formatted = formatArgValue(key, value)
  if (!formatted) {
    return label
  }
  return `${label}: ${formatted}`
}

const buildArgsSummary = (args: Record<string, unknown>): string[] => {
  const entries = Object.keys(args)
    .sort()
    .map((key) => ({ key, value: args[key] }))

  const lines = entries.slice(0, MAX_ARG_LINES).map(({ key, value }) => {
    const formatted = formatArgValue(key, value)
    return formatted ? `${key}: ${formatted}` : `${key}: (empty)`
  })

  if (entries.length > MAX_ARG_LINES) {
    lines.push(`… +${entries.length - MAX_ARG_LINES} more`)
  }

  return lines
}

const formatArgValue = (key: string, value: unknown): string | null => {
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return null
  }
  if (typeof value === 'string') {
    if (REDACT_KEYS.has(key)) {
      return value.length > 0 ? `${value.length} chars` : '(empty)'
    }
    if (value.length > MAX_INLINE_LENGTH) {
      const preview = value.slice(0, MAX_PREVIEW_LENGTH).trimEnd()
      return `${preview}… (${value.length} chars)`
    }
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
    const preview = keys.slice(0, 4).join(', ')
    const suffix = keys.length > 4 ? ', …' : ''
    return `object{${preview}${suffix}}`
  }
  return String(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
