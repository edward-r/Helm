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

const normalizeProviderFromString = (value: string): string => {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower.includes('openai')) {
    return 'openai'
  }
  if (lower.includes('google')) {
    return 'google'
  }
  return trimmed
}

const resolveProviderFromRecord = (value: Record<string, unknown>): string | undefined => {
  const name =
    normalizeOptionalString(value.name) ??
    normalizeOptionalString(value.id) ??
    normalizeOptionalString(value.provider) ??
    normalizeOptionalString(value.vendor) ??
    normalizeOptionalString(value.organization) ??
    normalizeOptionalString(value.owner)
  if (name) {
    return normalizeProviderFromString(name)
  }
  const npm = normalizeOptionalString(value.npm)
  if (npm) {
    return normalizeProviderFromString(npm)
  }
  const api = normalizeOptionalString(value.api)
  if (api) {
    return normalizeProviderFromString(api)
  }
  return undefined
}

const resolveModelId = (
  value: Record<string, unknown>,
  fallbackId?: string
): string | undefined => {
  return normalizeOptionalString(value.id) ?? normalizeOptionalString(value.model) ?? fallbackId
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

const resolveModelType = (value: Record<string, unknown>): string | undefined => {
  const type =
    normalizeOptionalString(value.type) ??
    normalizeOptionalString(value.modelType) ??
    normalizeOptionalString(value.model_type) ??
    normalizeOptionalString(value.kind)
  return type?.toLowerCase()
}

const resolveCapabilitiesList = (value: Record<string, unknown>): string[] => {
  const raw = value.capabilities ?? value.capability
  if (Array.isArray(raw)) {
    return normalizeStringArray(raw).map((entry) => entry.toLowerCase())
  }
  if (isRecord(raw)) {
    return Object.entries(raw)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key.toLowerCase())
  }
  if (typeof raw === 'string') {
    return normalizeStringArray(raw).map((entry) => entry.toLowerCase())
  }
  return []
}

const resolveOutputModalities = (value: Record<string, unknown>): string[] => {
  const modalities = value.modalities
  if (isRecord(modalities)) {
    const output = modalities.output ?? modalities.outputs ?? modalities.outputModalities
    return normalizeStringArray(output).map((entry) => entry.toLowerCase())
  }
  const output = value.output ?? value.outputs
  return normalizeStringArray(output).map((entry) => entry.toLowerCase())
}

const resolveModalitiesArray = (value: Record<string, unknown>): string[] => {
  const raw = value.modalities
  if (Array.isArray(raw) || typeof raw === 'string') {
    return normalizeStringArray(raw).map((entry) => entry.toLowerCase())
  }
  return []
}

const supportsTextGeneration = (value: Record<string, unknown>): boolean => {
  const type = resolveModelType(value)
  if (type === 'chat') {
    return true
  }

  const modalitiesArray = resolveModalitiesArray(value)
  if (modalitiesArray.includes('text')) {
    return true
  }

  const inputModalities = resolveInputModalities(value)
  if (inputModalities && inputModalities.includes('text')) {
    return true
  }

  const capabilities = resolveCapabilitiesList(value)
  if (capabilities.length > 0) {
    return capabilities.some((cap) => {
      return (
        cap.includes('text') ||
        cap.includes('chat') ||
        cap.includes('completion') ||
        cap.includes('generate')
      )
    })
  }

  const outputs = resolveOutputModalities(value)
  if (outputs.length > 0) {
    return outputs.includes('text')
  }

  return false
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

const resolveReasoning = (value: Record<string, unknown>): boolean | undefined => {
  const raw = value.reasoning ?? value.reasoningMode ?? value.reasoning_mode
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
  const id = resolveModelId(value, fallbackId)
  if (!id) {
    return null
  }
  const name =
    normalizeOptionalString(value.name) ??
    normalizeOptionalString(value.displayName) ??
    normalizeOptionalString(value.display_name) ??
    id
  const providerValue = value.provider
  const providerFromRecord = isRecord(providerValue)
    ? resolveProviderFromRecord(providerValue)
    : undefined
  const provider =
    providerFromRecord ??
    normalizeOptionalString(providerValue) ??
    normalizeOptionalString(value.vendor) ??
    normalizeOptionalString(value.organization) ??
    normalizeOptionalString(value.owner) ??
    providerHint ??
    'unknown'
  const contextLength = resolveContextLength(value)
  const toolCall = resolveToolCall(value)
  const reasoning = resolveReasoning(value)
  const inputModalities = resolveInputModalities(value)

  return {
    id,
    name,
    provider,
    ...(contextLength ? { contextLength } : {}),
    ...(toolCall !== undefined ? { toolCall } : {}),
    ...(inputModalities ? { inputModalities } : {}),
    ...(reasoning !== undefined ? { reasoning } : {})
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

type RawModelEntry = { raw: Record<string, unknown>; providerHint?: string }

const providerPriority = (label: string | undefined): number => {
  if (!label) {
    return 0
  }
  const normalized = normalizeProviderFromString(label).toLowerCase()
  if (normalized === 'openai' || normalized === 'google') {
    return 2
  }
  if (normalized.includes('openai') || normalized.includes('google')) {
    return 1
  }
  return 0
}

const collectRawModels = (payload: unknown, debugEnabled = false): Map<string, RawModelEntry> => {
  const rawMap = new Map<string, RawModelEntry>()
  if (isRecord(payload)) {
    for (const [providerKey, providerValue] of Object.entries(payload)) {
      if (!isRecord(providerValue) || !('models' in providerValue)) {
        continue
      }
      const providerLabel = resolveProviderLabel(providerKey, providerValue)
      const modelsValue = providerValue.models
      if (Array.isArray(modelsValue)) {
        for (const entry of modelsValue) {
          if (!isRecord(entry)) {
            continue
          }
          const id = resolveModelId(entry)
          if (!id || rawMap.has(id)) {
            if (id && rawMap.has(id)) {
              const existing = rawMap.get(id)
              const currentPriority = providerPriority(existing?.providerHint)
              const nextPriority = providerPriority(providerLabel)
              if (nextPriority > currentPriority) {
                rawMap.set(id, { raw: entry, providerHint: providerLabel })
                if (debugEnabled) {
                  console.warn(
                    `[models] prefer provider ${providerLabel} for ${id} (was ${existing?.providerHint ?? 'unknown'})`
                  )
                }
              }
            }
            continue
          }
          rawMap.set(id, { raw: entry, providerHint: providerLabel })
        }
        continue
      }
      if (isRecord(modelsValue)) {
        for (const [modelId, entry] of Object.entries(modelsValue)) {
          if (!isRecord(entry)) {
            continue
          }
          if (rawMap.has(modelId)) {
            const existing = rawMap.get(modelId)
            const currentPriority = providerPriority(existing?.providerHint)
            const nextPriority = providerPriority(providerLabel)
            if (nextPriority > currentPriority) {
              rawMap.set(modelId, { raw: entry, providerHint: providerLabel })
              if (debugEnabled) {
                console.warn(
                  `[models] prefer provider ${providerLabel} for ${modelId} (was ${existing?.providerHint ?? 'unknown'})`
                )
              }
            }
            continue
          }
          rawMap.set(modelId, { raw: entry, providerHint: providerLabel })
        }
      }
    }
  }

  if (rawMap.size === 0) {
    const candidates = collectCandidates(payload)
    for (const candidate of candidates) {
      if (!isRecord(candidate)) {
        continue
      }
      const id = resolveModelId(candidate)
      if (!id || rawMap.has(id)) {
        continue
      }
      rawMap.set(id, { raw: candidate })
    }
  }

  return rawMap
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
  const debugFlag = process.env.HELM_DEBUG_MODELS?.trim().toLowerCase()
  const debugEnabled = debugFlag === '1' || debugFlag === 'true' || debugFlag === 'yes'
  const response = await fetch('https://models.dev/api.json')
  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`)
  }
  const payload = (await response.json()) as unknown
  const rawModelMap = collectRawModels(payload, debugEnabled)
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
  const blockedFragments = ['-tts', 'tts', 'embedding', 'babbage', 'davinci', 'instruct', 'audio']
  const excluded: Array<{ id: string; provider: string; reason: string }> = []
  const debugExclude = (id: string, provider: string, reason: string) => {
    if (debugEnabled) {
      excluded.push({ id, provider, reason })
    }
  }

  const filtered: ModelInfo[] = []
  const rawEntries = Array.from(rawModelMap.entries())

  if (rawEntries.length === 0) {
    for (const model of models) {
      const provider = model.provider?.toLowerCase() ?? ''
      if (!allowedProviders.some((allowed) => provider.includes(allowed))) {
        debugExclude(model.id, model.provider, `provider:${model.provider}`)
        continue
      }

      const idLower = model.id.toLowerCase()
      const blockedFragment = blockedFragments.find((fragment) => idLower.includes(fragment))
      if (blockedFragment) {
        debugExclude(model.id, model.provider, `blocked-id:${blockedFragment}`)
        continue
      }

      filtered.push(model)
    }
  } else {
    for (const [modelId, entry] of rawEntries) {
      const raw = entry.raw
      const providerHint = entry.providerHint ?? ''
      const providerLabel = providerHint || resolveProviderFromRecord(raw) || 'unknown'
      const providerNormalized = normalizeProviderFromString(providerLabel).toLowerCase()
      if (!allowedProviders.some((allowed) => providerNormalized.includes(allowed))) {
        debugExclude(modelId, providerLabel, `provider:${providerLabel}`)
        continue
      }

      const idLower = modelId.toLowerCase()
      const blockedFragment = blockedFragments.find((fragment) => idLower.includes(fragment))
      if (blockedFragment) {
        debugExclude(modelId, providerLabel, `blocked-id:${blockedFragment}`)
        continue
      }

      const type = resolveModelType(raw)
      if (type && type !== 'chat') {
        debugExclude(modelId, providerLabel, `type:${type}`)
        continue
      }

      const capabilities = resolveCapabilitiesList(raw)
      const outputs = resolveOutputModalities(raw)
      const modalitiesArray = resolveModalitiesArray(raw)
      if (modalitiesArray.length > 0 && !modalitiesArray.includes('text')) {
        debugExclude(modelId, providerLabel, `modalities:${modalitiesArray.join(',')}`)
        continue
      }

      const hasCapabilityFields = Boolean(
        type || capabilities.length > 0 || outputs.length > 0 || modalitiesArray.length > 0
      )
      const supportsText = supportsTextGeneration(raw)

      if (idLower.includes('vision') && !supportsText) {
        debugExclude(modelId, providerLabel, 'vision-no-text')
        continue
      }

      if (hasCapabilityFields && !supportsText) {
        debugExclude(modelId, providerLabel, 'capabilities-no-text')
        continue
      }

      const info = toModelInfo(raw, modelId, providerLabel)
      if (info) {
        filtered.push(info)
      }
    }
  }

  const forcedModelId = 'gemini-3.1-pro-preview-customtools'
  const forcedEntry = rawModelMap.get(forcedModelId)
  if (forcedEntry && !filtered.some((model) => model.id === forcedModelId)) {
    const raw = forcedEntry.raw
    const providerLabel = forcedEntry.providerHint ?? resolveProviderFromRecord(raw) ?? 'google'
    const providerNormalized = normalizeProviderFromString(providerLabel).toLowerCase()
    const type = resolveModelType(raw)
    const modalities = resolveModalitiesArray(raw)
    const supportsText = supportsTextGeneration(raw)
    const isAllowedProvider = allowedProviders.some((allowed) =>
      providerNormalized.includes(allowed)
    )
    const hasTextModalities = modalities.length === 0 || modalities.includes('text')
    if (isAllowedProvider && (!type || type === 'chat') && supportsText && hasTextModalities) {
      const forcedInfo = toModelInfo(raw, forcedModelId, providerLabel)
      if (forcedInfo) {
        filtered.push(forcedInfo)
        if (debugEnabled) {
          console.warn('[models] force-include', forcedModelId)
        }
      }
    }
  }

  if (debugEnabled) {
    console.warn(
      `[models] total=${rawEntries.length || models.length} filtered=${filtered.length} excluded=${excluded.length}`
    )
    const maxLogs = 200
    for (const entry of excluded.slice(0, maxLogs)) {
      console.warn(`[models] exclude ${entry.id} (${entry.provider}) -> ${entry.reason}`)
    }
    if (excluded.length > maxLogs) {
      console.warn(`[models] excluded list truncated (${maxLogs}/${excluded.length})`)
    }
  }

  return filtered.sort((left, right) => {
    const providerCompare = left.provider.localeCompare(right.provider)
    if (providerCompare !== 0) {
      return providerCompare
    }
    return left.name.localeCompare(right.name)
  })
}
