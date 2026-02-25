import { callLLM } from '@prompt-maker/core'
import type { Message } from '@prompt-maker/core'

import type { ValidationReport } from '../../shared/trpc'

const VALIDATION_SYSTEM_PROMPT =
  'You are an expert AI Prompt Engineer. Evaluate the following prompt. Return ONLY valid JSON matching this schema: ' +
  '{ "score": number (0-100), "feedback": string[] (what works well), "improvements": string[] (what is missing or vague) }.'

type JsonParseResult = { ok: true; value: unknown } | { ok: false }

const tryParseJson = (value: string): JsonParseResult => {
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch {
    return { ok: false }
  }
}

const stripCodeFence = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }
  const lines = trimmed.split('\n')
  const withoutFirst = lines.slice(1)
  if (withoutFirst.length === 0) {
    return ''
  }
  const lastIndex = withoutFirst.length - 1
  if (withoutFirst[lastIndex]?.trim().startsWith('```')) {
    withoutFirst.pop()
  }
  return withoutFirst.join('\n').trim()
}

const extractJsonObject = (value: string): string | null => {
  const start = value.indexOf('{')
  const end = value.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return null
  }
  return value.slice(start, end + 1)
}

const parseValidationPayload = (value: string): ValidationReport => {
  const trimmed = value.trim()
  const direct = tryParseJson(trimmed)
  if (direct.ok) {
    return validateReport(direct.value)
  }

  const withoutFence = stripCodeFence(trimmed)
  const fenced = tryParseJson(withoutFence)
  if (fenced.ok) {
    return validateReport(fenced.value)
  }

  const extracted = extractJsonObject(withoutFence)
  if (extracted) {
    const extractedParsed = tryParseJson(extracted)
    if (extractedParsed.ok) {
      return validateReport(extractedParsed.value)
    }
  }

  throw new Error('Validation response was not valid JSON.')
}

const validateReport = (value: unknown): ValidationReport => {
  if (!isRecord(value)) {
    throw new Error('Validation response must be a JSON object.')
  }
  const score = value.score
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('Validation score must be a number between 0 and 100.')
  }
  const feedback = value.feedback
  if (!isStringArray(feedback)) {
    throw new Error('Validation feedback must be an array of strings.')
  }
  const improvements = value.improvements
  if (!isStringArray(improvements)) {
    throw new Error('Validation improvements must be an array of strings.')
  }
  return { score, feedback, improvements }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

export const evaluatePrompt = async (
  promptText: string,
  model: string
): Promise<ValidationReport> => {
  const messages: Message[] = [
    { role: 'system', content: VALIDATION_SYSTEM_PROMPT },
    { role: 'user', content: promptText }
  ]
  const result = await callLLM(messages, model)
  const content = typeof result.content === 'string' ? result.content.trim() : ''
  if (!content) {
    throw new Error('Validation response was empty.')
  }
  return parseValidationPayload(content)
}
