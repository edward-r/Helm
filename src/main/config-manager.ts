import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { AppConfig, ModelInfo } from '../shared/trpc'

type ConfigUpdates = Partial<AppConfig>

const resolveConfigPath = (): string => {
  return path.join(app.getPath('userData'), 'helm-settings.json')
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', '1'].includes(normalized)) {
      return true
    }
    if (['false', 'no', '0'].includes(normalized)) {
      return false
    }
  }
  return undefined
}

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  return []
}

const sanitizeConfig = (value: unknown): AppConfig => {
  if (!isRecord(value)) {
    return {}
  }
  return {
    openaiKey: normalizeOptionalString(value.openaiKey),
    geminiKey: normalizeOptionalString(value.geminiKey),
    defaultModel: normalizeOptionalString(value.defaultModel)
  }
}

export const getConfig = async (): Promise<AppConfig> => {
  const filePath = resolveConfigPath()
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return sanitizeConfig(parsed)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err && err.code === 'ENOENT') {
      return {}
    }
    return {}
  }
}

export const updateConfig = async (updates: ConfigUpdates): Promise<AppConfig> => {
  const current = await getConfig()
  const next: AppConfig = { ...current }

  if ('openaiKey' in updates) {
    next.openaiKey = normalizeOptionalString(updates.openaiKey)
  }
  if ('geminiKey' in updates) {
    next.geminiKey = normalizeOptionalString(updates.geminiKey)
  }
  if ('defaultModel' in updates) {
    next.defaultModel = normalizeOptionalString(updates.defaultModel)
  }

  const filePath = resolveConfigPath()
  await fs.writeFile(filePath, JSON.stringify(next, null, 2), 'utf8')
  return next
}

const resolveContextLength = (value: Record<string, unknown>): number | undefined => {
  const direct =
    coerceNumber(value.contextLength) ??
    coerceNumber(value.context_length) ??
    coerceNumber(value.maxContextLength) ??
    coerceNumber(value.max_context_length) ??
    coerceNumber(value.contextWindow) ??
    coerceNumber(value.context_window)
  if (direct) {
    return direct
  }
  const limit = value.limit
  if (isRecord(limit)) {
    const nested =
      coerceNumber(limit.context) ??
      coerceNumber(limit.contextLength) ??
      coerceNumber(limit.context_length) ??
      coerceNumber(limit.max_context_length)
    if (nested) {
      return nested
    }
  }
  const limits = value.limits
  if (isRecord(limits)) {
    const nested =
      coerceNumber(limits.context) ??
      coerceNumber(limits.contextLength) ??
      coerceNumber(limits.context_length) ??
      coerceNumber(limits.max_context_length)
    if (nested) {
      return nested
    }
  }
  return undefined
}

const resolveToolCall = (value: Record<string, unknown>): boolean | undefined => {
  const raw =
    value.tool_call ??
    value.toolCall ??
    value.toolCalls ??
    value.tools ??
    value.tooling ??
    value.functionCalling ??
    value.function_calling
  return coerceBoolean(raw)
}

const resolveInputModalities = (value: Record<string, unknown>): string[] | undefined => {
  const candidates: unknown[] = []
  if (value.modalities !== undefined) {
    candidates.push(value.modalities)
  }
  if (value.modalities_input !== undefined) {
    candidates.push(value.modalities_input)
  }
  if (value.input_modalities !== undefined) {
    candidates.push(value.input_modalities)
  }

  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      const input =
        candidate.input ??
        candidate.inputs ??
        candidate.modalitiesInput ??
        candidate.modalities_input
      const list = normalizeStringArray(input)
      if (list.length > 0) {
        return Array.from(new Set(list)).sort((left, right) => left.localeCompare(right))
      }
    }
    const list = normalizeStringArray(candidate)
    if (list.length > 0) {
      return Array.from(new Set(list)).sort((left, right) => left.localeCompare(right))
    }
  }

  const direct = normalizeStringArray(value.modalitiesInput)
  if (direct.length > 0) {
    return Array.from(new Set(direct)).sort((left, right) => left.localeCompare(right))
  }
  return undefined
}

const toModelInfo = (
  value: unknown,
  fallbackId?: string,
  providerHint?: string
): ModelInfo | null => {
  if (!isRecord(value)) {
    return null
  }
  const id = normalizeOptionalString(value.id) ?? normalizeOptionalString(value.model) ?? fallbackId
  if (!id) {
    return null
  }
  const name =
    normalizeOptionalString(value.name) ??
    normalizeOptionalString(value.displayName) ??
    normalizeOptionalString(value.display_name) ??
    id
  const provider =
    normalizeOptionalString(value.provider) ??
    normalizeOptionalString(value.vendor) ??
    normalizeOptionalString(value.organization) ??
    normalizeOptionalString(value.owner) ??
    providerHint ??
    'unknown'
  const contextLength = resolveContextLength(value)
  const toolCall = resolveToolCall(value)
  const inputModalities = resolveInputModalities(value)

  return {
    id,
    name,
    provider,
    ...(contextLength ? { contextLength } : {}),
    ...(toolCall !== undefined ? { toolCall } : {}),
    ...(inputModalities ? { inputModalities } : {})
  }
}

const collectCandidates = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value
  }
  if (!isRecord(value)) {
    return []
  }
  if (Array.isArray(value.models)) {
    return value.models
  }
  if (Array.isArray(value.data)) {
    return value.data
  }
  if (Array.isArray(value.items)) {
    return value.items
  }

  const candidates: unknown[] = []
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) {
      candidates.push(...entry)
    } else if (isRecord(entry)) {
      if (Array.isArray(entry.models)) {
        candidates.push(...entry.models)
      }
      if (Array.isArray(entry.items)) {
        candidates.push(...entry.items)
      }
      if (Array.isArray(entry.data)) {
        candidates.push(...entry.data)
      }
    }
  }
  return candidates
}

const resolveProviderLabel = (providerKey: string, providerValue: unknown): string => {
  if (!isRecord(providerValue)) {
    return providerKey
  }
  return (
    normalizeOptionalString(providerValue.name) ??
    normalizeOptionalString(providerValue.id) ??
    providerKey
  )
}

const collectProviderModels = (payload: Record<string, unknown>): ModelInfo[] => {
  const modelMap = new Map<string, ModelInfo>()
  for (const [providerKey, providerValue] of Object.entries(payload)) {
    if (!isRecord(providerValue)) {
      continue
    }
    if (!('models' in providerValue)) {
      continue
    }
    const providerLabel = resolveProviderLabel(providerKey, providerValue)
    const modelsValue = providerValue.models
    if (Array.isArray(modelsValue)) {
      for (const entry of modelsValue) {
        const info = toModelInfo(entry, undefined, providerLabel)
        if (info && !modelMap.has(info.id)) {
          modelMap.set(info.id, info)
        }
      }
      continue
    }
    if (isRecord(modelsValue)) {
      for (const [modelId, entry] of Object.entries(modelsValue)) {
        const info = toModelInfo(entry, modelId, providerLabel)
        if (info && !modelMap.has(info.id)) {
          modelMap.set(info.id, info)
        }
      }
    }
  }
  return Array.from(modelMap.values())
}

export const fetchAvailableModels = async (): Promise<ModelInfo[]> => {
  const response = await fetch('https://models.dev/api.json')
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`)
  }
  const payload = (await response.json()) as unknown
  let models: ModelInfo[] = []
  if (isRecord(payload)) {
    const providerModels = collectProviderModels(payload)
    if (providerModels.length > 0) {
      models = providerModels
    }
  }
  if (models.length === 0) {
    const candidates = collectCandidates(payload)
    const modelMap = new Map<string, ModelInfo>()
    for (const candidate of candidates) {
      const info = toModelInfo(candidate)
      if (!info) {
        continue
      }
      if (!modelMap.has(info.id)) {
        modelMap.set(info.id, info)
      }
    }
    models = Array.from(modelMap.values())
  }

  const allowedProviders = ['openai', 'google']
  const filtered = models.filter((model) => {
    const provider = model.provider?.toLowerCase() ?? ''
    return allowedProviders.some((allowed) => provider.includes(allowed))
  })

  return filtered.sort((left, right) => {
    const providerCompare = left.provider.localeCompare(right.provider)
    if (providerCompare !== 0) {
      return providerCompare
    }
    return left.name.localeCompare(right.name)
  })
}
