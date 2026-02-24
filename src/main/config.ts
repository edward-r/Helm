import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { ModelDefinition, ModelProvider } from './model-providers'
import type { ThemeMode } from './tui/theme/theme-types'

export type ContextOverflowStrategy =
  | 'fail'
  | 'drop-smart'
  | 'drop-url'
  | 'drop-largest'
  | 'drop-oldest'

export type PromptGeneratorConfig = {
  defaultModel?: string
  defaultGeminiModel?: string
  models?: ModelDefinition[]
  maxInputTokens?: number
  maxContextTokens?: number
  contextOverflowStrategy?: ContextOverflowStrategy
  enableValidation?: boolean
  validationThreshold?: number
  autoTune?: boolean
  targetScore?: number
  enableRefinementSuggestions?: boolean
  autoApplyRefinements?: boolean
  suggestionThreshold?: number
  suggestTemplates?: boolean
  favoriteTemplates?: string[]
  useExamples?: boolean
  maxExamples?: number
  minExampleRating?: number
  autoAddExamples?: boolean
  enableFeedbackCollection?: boolean
  promptForRating?: boolean
  collectImplicit?: boolean
  enableAutoDecomposition?: boolean
  decompositionThreshold?: 'low' | 'medium' | 'high'
  maxSubTasks?: number
  defaultDecompositionStrategy?: 'sequential' | 'parallel' | 'hierarchical' | 'auto'
}

export type ScrapeOutputFormat = 'markdown' | 'html' | 'json'

export type PuppeteerHeadlessMode = boolean | 'new'

export type PuppeteerConfig = {
  headless?: PuppeteerHeadlessMode
  navigationTimeoutMs?: number
  operationTimeoutMs?: number
  slowMoMs?: number
  executablePath?: string
  args?: string[]
  userAgent?: string
}

export type ScrapeConfig = {
  outputDir?: string
  outputFormat?: ScrapeOutputFormat
  puppeteer?: PuppeteerConfig
}

export type SearchWebConfig = {
  resultsLimit?: number
  proxy?: string
  outputDir?: string
  puppeteer?: PuppeteerConfig
}

export type TuiResumeMode = 'best-effort' | 'strict'
export type TuiResumeSourceKind = 'history' | 'file'

export type PromptMakerCliConfig = {
  openaiApiKey?: string
  openaiBaseUrl?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  promptGenerator?: PromptGeneratorConfig
  contextTemplates?: Record<string, string>
  scrape?: ScrapeConfig
  searchWeb?: SearchWebConfig
  headlessMode?: boolean

  // TUI theme settings (persisted).
  theme?: string
  themeMode?: ThemeMode

  // TUI resume defaults (persisted).
  resumeMode?: TuiResumeMode
  resumeSourceKind?: TuiResumeSourceKind

  // TUI history list cap (persisted).
  historyListLimit?: number

  // TUI export defaults (persisted).
  exportFormat?: 'json' | 'yaml'
  exportOutDir?: string

  // TUI validation modal defaults (persisted).
  tuiFixSuggestionsEnabled?: boolean
}

let cachedConfig: PromptMakerCliConfig | null | undefined
let cachedConfigPath: string | null | undefined

const getCandidateConfigPaths = (): string[] => {
  const explicit = process.env.PROMPT_MAKER_CLI_CONFIG?.trim()
  const home = os.homedir()
  const defaults = [
    path.join(home, '.config', 'prompt-maker-cli', 'config.json'),
    path.join(home, '.prompt-maker-cli.json'),
  ]

  return [explicit, ...defaults].filter((value): value is string => Boolean(value))
}

const getDefaultConfigPath = (): string => {
  const home = os.homedir()
  return path.join(home, '.config', 'prompt-maker-cli', 'config.json')
}

const resolveConfigPathForWrite = async (): Promise<string> => {
  const explicit = process.env.PROMPT_MAKER_CLI_CONFIG?.trim()
  if (explicit) {
    return explicit
  }

  if (cachedConfigPath) {
    return cachedConfigPath
  }

  for (const candidate of getCandidateConfigPaths()) {
    try {
      await fs.stat(candidate)
      return candidate
    } catch (error) {
      if (isFileMissingError(error)) {
        continue
      }
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to access config at ${candidate}: ${message}`)
    }
  }

  return getDefaultConfigPath()
}

export const loadCliConfig = async (): Promise<PromptMakerCliConfig | null> => {
  if (cachedConfig !== undefined) {
    return cachedConfig
  }

  for (const filePath of getCandidateConfigPaths()) {
    try {
      const contents = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(contents) as unknown
      const config = parseConfig(parsed)
      cachedConfig = config
      cachedConfigPath = filePath
      return config
    } catch (error) {
      if (isFileMissingError(error)) {
        continue
      }

      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to load config at ${filePath}: ${message}`)
    }
  }

  cachedConfig = null
  cachedConfigPath = null
  return null
}

export const resolveOpenAiCredentials = async (): Promise<{
  apiKey: string
  baseUrl?: string
}> => {
  const envKey = process.env.OPENAI_API_KEY?.trim()
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim()

  if (envKey) {
    const credentials: { apiKey: string; baseUrl?: string } = { apiKey: envKey }
    if (envBaseUrl) {
      credentials.baseUrl = envBaseUrl
    }
    return credentials
  }

  const config = await loadCliConfig()
  const apiKey = config?.openaiApiKey?.trim()

  if (apiKey) {
    const baseUrl = config?.openaiBaseUrl?.trim()
    const credentials: { apiKey: string; baseUrl?: string } = { apiKey }
    if (baseUrl) {
      credentials.baseUrl = baseUrl
    }
    return credentials
  }

  throw new Error(
    'Missing OpenAI credentials. Set OPENAI_API_KEY or add "openaiApiKey" to ~/.config/prompt-maker-cli/config.json.',
  )
}

export const resolveGeminiCredentials = async (): Promise<{
  apiKey: string
  baseUrl?: string
}> => {
  const envKey = process.env.GEMINI_API_KEY?.trim()
  const envBaseUrl = process.env.GEMINI_BASE_URL?.trim()

  if (envKey) {
    const credentials: { apiKey: string; baseUrl?: string } = { apiKey: envKey }
    if (envBaseUrl) {
      credentials.baseUrl = envBaseUrl
    }
    return credentials
  }

  const config = await loadCliConfig()
  const apiKey = config?.geminiApiKey?.trim()

  if (apiKey) {
    const baseUrl = config?.geminiBaseUrl?.trim()
    const credentials: { apiKey: string; baseUrl?: string } = { apiKey }
    if (baseUrl) {
      credentials.baseUrl = baseUrl
    }
    return credentials
  }

  throw new Error(
    'Missing Gemini credentials. Set GEMINI_API_KEY or add "geminiApiKey" to ~/.config/prompt-maker-cli/config.json.',
  )
}

export type ResolvedScrapeConfig = {
  outputDir: string
  outputFormat: ScrapeOutputFormat
  puppeteer: PuppeteerConfig
}

export type ResolvedSearchWebConfig = {
  resultsLimit: number
  proxy?: string
  outputDir?: string
  puppeteer: PuppeteerConfig
}

const DEFAULT_SCRAPE_OUTPUT_DIR = 'generated/scrape'
const DEFAULT_SCRAPE_OUTPUT_FORMAT: ScrapeOutputFormat = 'markdown'
const DEFAULT_PUPPETEER_HEADLESS: PuppeteerHeadlessMode = true
const DEFAULT_PUPPETEER_NAVIGATION_TIMEOUT_MS = 30_000
const DEFAULT_PUPPETEER_OPERATION_TIMEOUT_MS = 30_000
const DEFAULT_PUPPETEER_USER_AGENT = 'prompt-maker-cli'
const DEFAULT_SEARCH_WEB_RESULTS_LIMIT = 5
const DEFAULT_SEARCH_WEB_NAVIGATION_TIMEOUT_MS = 15_000
const DEFAULT_SEARCH_WEB_OPERATION_TIMEOUT_MS = 30_000
const DEFAULT_SEARCH_WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const resolveScrapeConfig = async (): Promise<ResolvedScrapeConfig> => {
  const config = await loadCliConfig()
  const configScrape = config?.scrape
  const envOverrides = parseScrapeEnvOverrides()
  const headlessMode = resolveHeadlessMode(config)

  const puppeteer: PuppeteerConfig = {
    headless: headlessMode ?? DEFAULT_PUPPETEER_HEADLESS,
    navigationTimeoutMs: DEFAULT_PUPPETEER_NAVIGATION_TIMEOUT_MS,
    operationTimeoutMs: DEFAULT_PUPPETEER_OPERATION_TIMEOUT_MS,
    userAgent: DEFAULT_PUPPETEER_USER_AGENT,
    ...(configScrape?.puppeteer ?? {}),
    ...(envOverrides.puppeteer ?? {}),
  }

  return {
    outputDir: envOverrides.outputDir ?? configScrape?.outputDir ?? DEFAULT_SCRAPE_OUTPUT_DIR,
    outputFormat:
      envOverrides.outputFormat ?? configScrape?.outputFormat ?? DEFAULT_SCRAPE_OUTPUT_FORMAT,
    puppeteer,
  }
}

export const resolveSearchWebConfig = async (): Promise<ResolvedSearchWebConfig> => {
  const config = await loadCliConfig()
  const configSearch = config?.searchWeb
  const envOverrides = parseSearchWebEnvOverrides()
  const headlessMode = resolveHeadlessMode(config)

  const puppeteer: PuppeteerConfig = {
    headless: headlessMode ?? DEFAULT_PUPPETEER_HEADLESS,
    navigationTimeoutMs: DEFAULT_SEARCH_WEB_NAVIGATION_TIMEOUT_MS,
    operationTimeoutMs: DEFAULT_SEARCH_WEB_OPERATION_TIMEOUT_MS,
    userAgent: DEFAULT_SEARCH_WEB_USER_AGENT,
    ...(configSearch?.puppeteer ?? {}),
    ...(envOverrides.puppeteer ?? {}),
  }

  const resolved: ResolvedSearchWebConfig = {
    resultsLimit:
      envOverrides.resultsLimit ?? configSearch?.resultsLimit ?? DEFAULT_SEARCH_WEB_RESULTS_LIMIT,
    puppeteer,
  }

  const proxy = envOverrides.proxy ?? configSearch?.proxy
  if (proxy) {
    resolved.proxy = proxy
  }

  const outputDir = envOverrides.outputDir ?? configSearch?.outputDir
  if (outputDir) {
    resolved.outputDir = outputDir
  }

  return resolved
}

export type ThemeSettingsPatch = {
  theme?: string | null
  themeMode?: ThemeMode | null
}

export type ResumeSettingsPatch = {
  resumeMode?: TuiResumeMode | null
  resumeSourceKind?: TuiResumeSourceKind | null
  historyListLimit?: number | null
}

export type ExportSettingsPatch = {
  exportFormat?: 'json' | 'yaml' | null
  exportOutDir?: string | null
}

export type TuiSettingsPatch = {
  tuiFixSuggestionsEnabled?: boolean | null
}

export const updateCliThemeSettings = async (
  patch: ThemeSettingsPatch,
  options?: { configPath?: string },
): Promise<void> => {
  const configPath = options?.configPath ?? (await resolveConfigPathForWrite())
  const directory = path.dirname(configPath)
  await fs.mkdir(directory, { recursive: true })

  let raw: unknown = {}
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    raw = JSON.parse(contents) as unknown
  } catch (error) {
    if (!isFileMissingError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to read config at ${configPath}: ${message}`)
    }
  }

  if (!isRecord(raw)) {
    throw new Error(`Failed to update config at ${configPath}: root must be a JSON object.`)
  }

  const next: Record<string, unknown> = { ...raw }

  if ('theme' in patch) {
    if (patch.theme === null || patch.theme === undefined || patch.theme.trim() === '') {
      delete next.theme
    } else {
      next.theme = patch.theme.trim()
    }
  }

  if ('themeMode' in patch) {
    if (patch.themeMode === null || patch.themeMode === undefined) {
      delete next.themeMode
    } else {
      next.themeMode = patch.themeMode
    }
  }

  const contents = JSON.stringify(next, null, 2)
  const tempFile = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(tempFile, `${contents}\n`, 'utf8')

  try {
    await fs.rename(tempFile, configPath)
  } catch {
    await fs.writeFile(configPath, `${contents}\n`, 'utf8')
  }

  cachedConfig = parseConfig(next)
  cachedConfigPath = configPath
}

export const updateCliResumeSettings = async (
  patch: ResumeSettingsPatch,
  options?: { configPath?: string },
): Promise<void> => {
  const configPath = options?.configPath ?? (await resolveConfigPathForWrite())
  const directory = path.dirname(configPath)
  await fs.mkdir(directory, { recursive: true })

  let raw: unknown = {}
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    raw = JSON.parse(contents) as unknown
  } catch (error) {
    if (!isFileMissingError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to read config at ${configPath}: ${message}`)
    }
  }

  if (!isRecord(raw)) {
    throw new Error(`Failed to update config at ${configPath}: root must be a JSON object.`)
  }

  const next: Record<string, unknown> = { ...raw }

  if ('resumeMode' in patch) {
    if (patch.resumeMode === null || patch.resumeMode === undefined) {
      delete next.resumeMode
    } else {
      next.resumeMode = expectResumeMode(patch.resumeMode, 'resumeMode')
    }
  }

  if ('resumeSourceKind' in patch) {
    if (patch.resumeSourceKind === null || patch.resumeSourceKind === undefined) {
      delete next.resumeSourceKind
    } else {
      next.resumeSourceKind = expectResumeSourceKind(patch.resumeSourceKind, 'resumeSourceKind')
    }
  }

  if ('historyListLimit' in patch) {
    if (patch.historyListLimit === null || patch.historyListLimit === undefined) {
      delete next.historyListLimit
      delete next.resumeHistoryLimit
    } else {
      next.historyListLimit = expectPositiveInteger(patch.historyListLimit, 'historyListLimit')
      delete next.resumeHistoryLimit
    }
  }

  const contents = JSON.stringify(next, null, 2)
  const tempFile = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(tempFile, `${contents}\n`, 'utf8')

  try {
    await fs.rename(tempFile, configPath)
  } catch {
    await fs.writeFile(configPath, `${contents}\n`, 'utf8')
  }

  cachedConfig = parseConfig(next)
  cachedConfigPath = configPath
}

export const updateCliExportSettings = async (
  patch: ExportSettingsPatch,
  options?: { configPath?: string },
): Promise<void> => {
  const configPath = options?.configPath ?? (await resolveConfigPathForWrite())
  const directory = path.dirname(configPath)
  await fs.mkdir(directory, { recursive: true })

  let raw: unknown = {}
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    raw = JSON.parse(contents) as unknown
  } catch (error) {
    if (!isFileMissingError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to read config at ${configPath}: ${message}`)
    }
  }

  if (!isRecord(raw)) {
    throw new Error(`Failed to update config at ${configPath}: root must be a JSON object.`)
  }

  const next: Record<string, unknown> = { ...raw }

  if ('exportFormat' in patch) {
    if (patch.exportFormat === null || patch.exportFormat === undefined) {
      delete next.exportFormat
    } else {
      next.exportFormat = expectExportFormat(patch.exportFormat, 'exportFormat')
    }
  }

  if ('exportOutDir' in patch) {
    const outDir = patch.exportOutDir
    if (outDir === null || outDir === undefined || outDir.trim() === '') {
      delete next.exportOutDir
    } else {
      next.exportOutDir = outDir.trim()
    }
  }

  const contents = JSON.stringify(next, null, 2)
  const tempFile = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(tempFile, `${contents}\n`, 'utf8')

  try {
    await fs.rename(tempFile, configPath)
  } catch {
    await fs.writeFile(configPath, `${contents}\n`, 'utf8')
  }

  cachedConfig = parseConfig(next)
  cachedConfigPath = configPath
}

export const updateCliTuiSettings = async (
  patch: TuiSettingsPatch,
  options?: { configPath?: string },
): Promise<void> => {
  const configPath = options?.configPath ?? (await resolveConfigPathForWrite())
  const directory = path.dirname(configPath)
  await fs.mkdir(directory, { recursive: true })

  let raw: unknown = {}
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    raw = JSON.parse(contents) as unknown
  } catch (error) {
    if (!isFileMissingError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to read config at ${configPath}: ${message}`)
    }
  }

  if (!isRecord(raw)) {
    throw new Error(`Failed to update config at ${configPath}: root must be a JSON object.`)
  }

  const next: Record<string, unknown> = { ...raw }

  if ('tuiFixSuggestionsEnabled' in patch) {
    if (patch.tuiFixSuggestionsEnabled === null || patch.tuiFixSuggestionsEnabled === undefined) {
      delete next.tuiFixSuggestionsEnabled
    } else {
      next.tuiFixSuggestionsEnabled = expectBoolean(
        patch.tuiFixSuggestionsEnabled,
        'tuiFixSuggestionsEnabled',
      )
    }
  }

  const contents = JSON.stringify(next, null, 2)
  const tempFile = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(tempFile, `${contents}\n`, 'utf8')

  try {
    await fs.rename(tempFile, configPath)
  } catch {
    await fs.writeFile(configPath, `${contents}\n`, 'utf8')
  }

  cachedConfig = parseConfig(next)
  cachedConfigPath = configPath
}

export type PromptGeneratorSettingsPatch = {
  maxInputTokens?: number | null
  maxContextTokens?: number | null
  contextOverflowStrategy?: ContextOverflowStrategy | null
}

export const updateCliPromptGeneratorSettings = async (
  patch: PromptGeneratorSettingsPatch,
  options?: { configPath?: string },
): Promise<void> => {
  const configPath = options?.configPath ?? (await resolveConfigPathForWrite())
  const directory = path.dirname(configPath)
  await fs.mkdir(directory, { recursive: true })

  let raw: unknown = {}
  try {
    const contents = await fs.readFile(configPath, 'utf8')
    raw = JSON.parse(contents) as unknown
  } catch (error) {
    if (!isFileMissingError(error)) {
      const message = error instanceof Error ? error.message : 'Unknown config error.'
      throw new Error(`Failed to read config at ${configPath}: ${message}`)
    }
  }

  if (!isRecord(raw)) {
    throw new Error(`Failed to update config at ${configPath}: root must be a JSON object.`)
  }

  const next: Record<string, unknown> = { ...raw }

  const existingPromptGenerator = next.promptGenerator
  const promptGenerator = isRecord(existingPromptGenerator)
    ? { ...existingPromptGenerator }
    : ({} satisfies Record<string, unknown>)

  if ('maxInputTokens' in patch) {
    if (patch.maxInputTokens === null || patch.maxInputTokens === undefined) {
      delete promptGenerator.maxInputTokens
    } else {
      promptGenerator.maxInputTokens = expectPositiveInteger(
        patch.maxInputTokens,
        'promptGenerator.maxInputTokens',
      )
    }
  }

  if ('maxContextTokens' in patch) {
    if (patch.maxContextTokens === null || patch.maxContextTokens === undefined) {
      delete promptGenerator.maxContextTokens
    } else {
      promptGenerator.maxContextTokens = expectPositiveInteger(
        patch.maxContextTokens,
        'promptGenerator.maxContextTokens',
      )
    }
  }

  if ('contextOverflowStrategy' in patch) {
    if (patch.contextOverflowStrategy === null || patch.contextOverflowStrategy === undefined) {
      delete promptGenerator.contextOverflowStrategy
    } else {
      promptGenerator.contextOverflowStrategy = expectContextOverflowStrategy(
        patch.contextOverflowStrategy,
        'promptGenerator.contextOverflowStrategy',
      )
    }
  }

  if (Object.keys(promptGenerator).length === 0) {
    delete next.promptGenerator
  } else {
    next.promptGenerator = promptGenerator
  }

  const contents = JSON.stringify(next, null, 2)
  const tempFile = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(tempFile, `${contents}\n`, 'utf8')

  try {
    await fs.rename(tempFile, configPath)
  } catch {
    await fs.writeFile(configPath, `${contents}\n`, 'utf8')
  }

  cachedConfig = parseConfig(next)
  cachedConfigPath = configPath
}

const parseConfig = (raw: unknown): PromptMakerCliConfig => {
  if (!isRecord(raw)) {
    throw new Error('CLI config must be a JSON object.')
  }

  const config: PromptMakerCliConfig = {}

  if (raw.openaiApiKey !== undefined) {
    config.openaiApiKey = expectString(raw.openaiApiKey, 'openaiApiKey')
  }

  if (raw.openaiBaseUrl !== undefined) {
    config.openaiBaseUrl = expectString(raw.openaiBaseUrl, 'openaiBaseUrl')
  }

  if (raw.geminiApiKey !== undefined) {
    config.geminiApiKey = expectString(raw.geminiApiKey, 'geminiApiKey')
  }

  if (raw.geminiBaseUrl !== undefined) {
    config.geminiBaseUrl = expectString(raw.geminiBaseUrl, 'geminiBaseUrl')
  }

  if (raw.promptGenerator !== undefined) {
    if (!isRecord(raw.promptGenerator)) {
      throw new Error('"promptGenerator" must be an object if provided.')
    }

    const promptGenerator: PromptGeneratorConfig = {}
    if (raw.promptGenerator.defaultModel !== undefined) {
      promptGenerator.defaultModel = expectString(
        raw.promptGenerator.defaultModel,
        'promptGenerator.defaultModel',
      )
    }
    if (raw.promptGenerator.defaultGeminiModel !== undefined) {
      promptGenerator.defaultGeminiModel = expectString(
        raw.promptGenerator.defaultGeminiModel,
        'promptGenerator.defaultGeminiModel',
      )
    }
    if (raw.promptGenerator.models !== undefined) {
      promptGenerator.models = parsePromptGeneratorModels(raw.promptGenerator.models)
    }
    if (raw.promptGenerator.maxInputTokens !== undefined) {
      promptGenerator.maxInputTokens = expectPositiveInteger(
        raw.promptGenerator.maxInputTokens,
        'promptGenerator.maxInputTokens',
      )
    }
    if (raw.promptGenerator.maxContextTokens !== undefined) {
      promptGenerator.maxContextTokens = expectPositiveInteger(
        raw.promptGenerator.maxContextTokens,
        'promptGenerator.maxContextTokens',
      )
    }
    if (raw.promptGenerator.contextOverflowStrategy !== undefined) {
      promptGenerator.contextOverflowStrategy = expectContextOverflowStrategy(
        raw.promptGenerator.contextOverflowStrategy,
        'promptGenerator.contextOverflowStrategy',
      )
    }
    if (raw.promptGenerator.enableValidation !== undefined) {
      promptGenerator.enableValidation = expectBoolean(
        raw.promptGenerator.enableValidation,
        'promptGenerator.enableValidation',
      )
    }
    if (raw.promptGenerator.validationThreshold !== undefined) {
      promptGenerator.validationThreshold = expectScore(
        raw.promptGenerator.validationThreshold,
        'promptGenerator.validationThreshold',
      )
    }
    if (raw.promptGenerator.autoTune !== undefined) {
      promptGenerator.autoTune = expectBoolean(
        raw.promptGenerator.autoTune,
        'promptGenerator.autoTune',
      )
    }
    if (raw.promptGenerator.targetScore !== undefined) {
      promptGenerator.targetScore = expectScore(
        raw.promptGenerator.targetScore,
        'promptGenerator.targetScore',
      )
    }
    if (raw.promptGenerator.enableRefinementSuggestions !== undefined) {
      promptGenerator.enableRefinementSuggestions = expectBoolean(
        raw.promptGenerator.enableRefinementSuggestions,
        'promptGenerator.enableRefinementSuggestions',
      )
    }
    if (raw.promptGenerator.autoApplyRefinements !== undefined) {
      promptGenerator.autoApplyRefinements = expectBoolean(
        raw.promptGenerator.autoApplyRefinements,
        'promptGenerator.autoApplyRefinements',
      )
    }
    if (raw.promptGenerator.suggestionThreshold !== undefined) {
      promptGenerator.suggestionThreshold = expectScore(
        raw.promptGenerator.suggestionThreshold,
        'promptGenerator.suggestionThreshold',
      )
    }
    if (raw.promptGenerator.suggestTemplates !== undefined) {
      promptGenerator.suggestTemplates = expectBoolean(
        raw.promptGenerator.suggestTemplates,
        'promptGenerator.suggestTemplates',
      )
    }
    if (raw.promptGenerator.favoriteTemplates !== undefined) {
      promptGenerator.favoriteTemplates = expectStringArray(
        raw.promptGenerator.favoriteTemplates,
        'promptGenerator.favoriteTemplates',
      )
    }
    if (raw.promptGenerator.useExamples !== undefined) {
      promptGenerator.useExamples = expectBoolean(
        raw.promptGenerator.useExamples,
        'promptGenerator.useExamples',
      )
    }
    if (raw.promptGenerator.maxExamples !== undefined) {
      promptGenerator.maxExamples = expectPositiveInteger(
        raw.promptGenerator.maxExamples,
        'promptGenerator.maxExamples',
      )
    }
    if (raw.promptGenerator.minExampleRating !== undefined) {
      promptGenerator.minExampleRating = expectExampleRating(
        raw.promptGenerator.minExampleRating,
        'promptGenerator.minExampleRating',
      )
    }
    if (raw.promptGenerator.autoAddExamples !== undefined) {
      promptGenerator.autoAddExamples = expectBoolean(
        raw.promptGenerator.autoAddExamples,
        'promptGenerator.autoAddExamples',
      )
    }
    if (raw.promptGenerator.enableFeedbackCollection !== undefined) {
      promptGenerator.enableFeedbackCollection = expectBoolean(
        raw.promptGenerator.enableFeedbackCollection,
        'promptGenerator.enableFeedbackCollection',
      )
    }
    if (raw.promptGenerator.promptForRating !== undefined) {
      promptGenerator.promptForRating = expectBoolean(
        raw.promptGenerator.promptForRating,
        'promptGenerator.promptForRating',
      )
    }
    if (raw.promptGenerator.collectImplicit !== undefined) {
      promptGenerator.collectImplicit = expectBoolean(
        raw.promptGenerator.collectImplicit,
        'promptGenerator.collectImplicit',
      )
    }
    if (raw.promptGenerator.enableAutoDecomposition !== undefined) {
      promptGenerator.enableAutoDecomposition = expectBoolean(
        raw.promptGenerator.enableAutoDecomposition,
        'promptGenerator.enableAutoDecomposition',
      )
    }
    if (raw.promptGenerator.decompositionThreshold !== undefined) {
      promptGenerator.decompositionThreshold = expectDecompositionThreshold(
        raw.promptGenerator.decompositionThreshold,
        'promptGenerator.decompositionThreshold',
      )
    }
    if (raw.promptGenerator.maxSubTasks !== undefined) {
      promptGenerator.maxSubTasks = expectPositiveInteger(
        raw.promptGenerator.maxSubTasks,
        'promptGenerator.maxSubTasks',
      )
    }
    if (raw.promptGenerator.defaultDecompositionStrategy !== undefined) {
      promptGenerator.defaultDecompositionStrategy = expectDecompositionStrategy(
        raw.promptGenerator.defaultDecompositionStrategy,
        'promptGenerator.defaultDecompositionStrategy',
      )
    }
    config.promptGenerator = promptGenerator
  }

  if (raw.contextTemplates !== undefined) {
    if (!isRecord(raw.contextTemplates)) {
      throw new Error('"contextTemplates" must be an object if provided.')
    }
    const templates: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw.contextTemplates)) {
      templates[key] = expectString(value, `contextTemplates.${key}`)
    }
    config.contextTemplates = templates
  }

  if (raw.scrape !== undefined) {
    config.scrape = parseScrapeConfig(raw.scrape)
  }

  if (raw.searchWeb !== undefined) {
    config.searchWeb = parseSearchWebConfig(raw.searchWeb)
  }

  if (raw.headlessMode !== undefined) {
    config.headlessMode = expectBoolean(raw.headlessMode, 'headlessMode')
  }

  if (raw.theme !== undefined) {
    const theme = expectString(raw.theme, 'theme').trim()
    if (theme) {
      config.theme = theme
    }
  }

  if (raw.themeMode !== undefined) {
    config.themeMode = expectThemeMode(raw.themeMode, 'themeMode')
  }

  if (raw.resumeMode !== undefined) {
    config.resumeMode = expectResumeMode(raw.resumeMode, 'resumeMode')
  }

  if (raw.resumeSourceKind !== undefined) {
    config.resumeSourceKind = expectResumeSourceKind(raw.resumeSourceKind, 'resumeSourceKind')
  }

  if (raw.historyListLimit !== undefined) {
    config.historyListLimit = expectPositiveInteger(raw.historyListLimit, 'historyListLimit')
  } else if (raw.resumeHistoryLimit !== undefined) {
    config.historyListLimit = expectPositiveInteger(raw.resumeHistoryLimit, 'resumeHistoryLimit')
  }

  if (raw.exportFormat !== undefined) {
    config.exportFormat = expectExportFormat(raw.exportFormat, 'exportFormat')
  }

  if (raw.exportOutDir !== undefined) {
    const exportOutDir = expectString(raw.exportOutDir, 'exportOutDir').trim()
    if (exportOutDir) {
      config.exportOutDir = exportOutDir
    }
  }

  if (raw.tuiFixSuggestionsEnabled !== undefined) {
    config.tuiFixSuggestionsEnabled = expectBoolean(
      raw.tuiFixSuggestionsEnabled,
      'tuiFixSuggestionsEnabled',
    )
  }

  return config
}

const parsePromptGeneratorModels = (value: unknown): ModelDefinition[] => {
  if (!Array.isArray(value)) {
    throw new Error('"promptGenerator.models" must be an array when provided.')
  }
  return value.map((entry, index) => parsePromptGeneratorModel(entry, index))
}

const parsePromptGeneratorModel = (value: unknown, index: number): ModelDefinition => {
  if (!isRecord(value)) {
    throw new Error(`promptGenerator.models[${index}] must be an object.`)
  }
  const id = expectString(value.id, `promptGenerator.models[${index}].id`).trim()
  if (!id) {
    throw new Error(`promptGenerator.models[${index}].id must not be empty.`)
  }
  const model: ModelDefinition = { id }
  if (value.label !== undefined) {
    const label = expectString(value.label, `promptGenerator.models[${index}].label`).trim()
    if (label) {
      model.label = label
    }
  }
  if (value.provider !== undefined) {
    model.provider = expectProvider(value.provider, `promptGenerator.models[${index}].provider`)
  }
  if (value.description !== undefined) {
    const description = expectString(
      value.description,
      `promptGenerator.models[${index}].description`,
    ).trim()
    if (description) {
      model.description = description
    }
  }
  if (value.notes !== undefined) {
    const notes = expectString(value.notes, `promptGenerator.models[${index}].notes`).trim()
    if (notes) {
      model.notes = notes
    }
  }
  if (value.capabilities !== undefined) {
    const capabilities = parseCapabilitiesField(
      value.capabilities,
      `promptGenerator.models[${index}].capabilities`,
    )
    if (capabilities.length > 0) {
      model.capabilities = capabilities
    }
  }
  if (value.default !== undefined) {
    model.default = expectBoolean(value.default, `promptGenerator.models[${index}].default`)
  }
  return model
}

const parseScrapeConfig = (value: unknown): ScrapeConfig => {
  if (!isRecord(value)) {
    throw new Error('"scrape" must be an object if provided.')
  }

  const config: ScrapeConfig = {}

  if (value.outputDir !== undefined) {
    const outputDir = expectString(value.outputDir, 'scrape.outputDir').trim()
    if (outputDir) {
      config.outputDir = outputDir
    }
  }

  if (value.outputFormat !== undefined) {
    config.outputFormat = expectScrapeOutputFormat(value.outputFormat, 'scrape.outputFormat')
  }

  if (value.puppeteer !== undefined) {
    config.puppeteer = parsePuppeteerConfig(value.puppeteer)
  }

  return config
}

const parseSearchWebConfig = (value: unknown): SearchWebConfig => {
  if (!isRecord(value)) {
    throw new Error('"searchWeb" must be an object if provided.')
  }

  const config: SearchWebConfig = {}

  if (value.resultsLimit !== undefined) {
    config.resultsLimit = expectPositiveInteger(value.resultsLimit, 'searchWeb.resultsLimit')
  }

  if (value.proxy !== undefined) {
    const proxy = expectString(value.proxy, 'searchWeb.proxy').trim()
    if (proxy) {
      config.proxy = proxy
    }
  }

  if (value.outputDir !== undefined) {
    const outputDir = expectString(value.outputDir, 'searchWeb.outputDir').trim()
    if (outputDir) {
      config.outputDir = outputDir
    }
  }

  if (value.puppeteer !== undefined) {
    config.puppeteer = parsePuppeteerConfig(value.puppeteer)
  }

  return config
}

const parsePuppeteerConfig = (value: unknown): PuppeteerConfig => {
  if (!isRecord(value)) {
    throw new Error('"scrape.puppeteer" must be an object if provided.')
  }

  const config: PuppeteerConfig = {}

  if (value.headless !== undefined) {
    config.headless = expectPuppeteerHeadless(value.headless, 'scrape.puppeteer.headless')
  }

  if (value.navigationTimeoutMs !== undefined) {
    config.navigationTimeoutMs = expectPositiveInteger(
      value.navigationTimeoutMs,
      'scrape.puppeteer.navigationTimeoutMs',
    )
  }

  if (value.operationTimeoutMs !== undefined) {
    config.operationTimeoutMs = expectPositiveInteger(
      value.operationTimeoutMs,
      'scrape.puppeteer.operationTimeoutMs',
    )
  }

  if (value.slowMoMs !== undefined) {
    config.slowMoMs = expectPositiveInteger(value.slowMoMs, 'scrape.puppeteer.slowMoMs')
  }

  if (value.executablePath !== undefined) {
    const executablePath = expectString(value.executablePath, 'scrape.puppeteer.executablePath')
    if (executablePath.trim()) {
      config.executablePath = executablePath.trim()
    }
  }

  if (value.args !== undefined) {
    config.args = expectStringArray(value.args, 'scrape.puppeteer.args')
  }

  if (value.userAgent !== undefined) {
    const userAgent = expectString(value.userAgent, 'scrape.puppeteer.userAgent').trim()
    if (userAgent) {
      config.userAgent = userAgent
    }
  }

  return config
}

const parseCapabilitiesField = (value: unknown, label: string): string[] => {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : []
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, idx) => expectString(entry, `${label}[${idx}]`).trim())
      .filter((entry) => entry.length > 0)
  }
  throw new Error(`${label} must be a string or array of strings.`)
}

const CONTEXT_OVERFLOW_STRATEGIES = [
  'fail',
  'drop-smart',
  'drop-url',
  'drop-largest',
  'drop-oldest',
] as const satisfies ReadonlyArray<ContextOverflowStrategy>

function expectPositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function expectContextOverflowStrategy(value: unknown, label: string): ContextOverflowStrategy {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${CONTEXT_OVERFLOW_STRATEGIES.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if (isContextOverflowStrategy(normalized)) {
    return normalized
  }
  throw new Error(`${label} must be one of: ${CONTEXT_OVERFLOW_STRATEGIES.join(', ')}.`)
}

const DECOMPOSITION_THRESHOLDS = ['low', 'medium', 'high'] as const
type DecompositionThreshold = (typeof DECOMPOSITION_THRESHOLDS)[number]

const DECOMPOSITION_STRATEGIES = ['sequential', 'parallel', 'hierarchical', 'auto'] as const
type DecompositionStrategy = (typeof DECOMPOSITION_STRATEGIES)[number]

function expectDecompositionThreshold(value: unknown, label: string): DecompositionThreshold {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${DECOMPOSITION_THRESHOLDS.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((DECOMPOSITION_THRESHOLDS as readonly string[]).includes(normalized)) {
    return normalized as DecompositionThreshold
  }
  throw new Error(`${label} must be one of: ${DECOMPOSITION_THRESHOLDS.join(', ')}.`)
}

function expectDecompositionStrategy(value: unknown, label: string): DecompositionStrategy {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${DECOMPOSITION_STRATEGIES.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((DECOMPOSITION_STRATEGIES as readonly string[]).includes(normalized)) {
    return normalized as DecompositionStrategy
  }
  throw new Error(`${label} must be one of: ${DECOMPOSITION_STRATEGIES.join(', ')}.`)
}

function expectScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1.`)
  }
  return value
}

function expectStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`)
  }
  return value.map((entry, index) => expectString(entry, `${label}[${index}]`).trim())
}

function isContextOverflowStrategy(value: string): value is ContextOverflowStrategy {
  return CONTEXT_OVERFLOW_STRATEGIES.includes(value as ContextOverflowStrategy)
}

const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

const RESUME_MODES = ['best-effort', 'strict'] as const satisfies ReadonlyArray<TuiResumeMode>

const expectResumeMode = (value: unknown, label: string): TuiResumeMode => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${RESUME_MODES.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((RESUME_MODES as readonly string[]).includes(normalized)) {
    return normalized as TuiResumeMode
  }
  throw new Error(`${label} must be one of: ${RESUME_MODES.join(', ')}.`)
}

const RESUME_SOURCE_KINDS = [
  'history',
  'file',
] as const satisfies ReadonlyArray<TuiResumeSourceKind>

const expectResumeSourceKind = (value: unknown, label: string): TuiResumeSourceKind => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${RESUME_SOURCE_KINDS.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((RESUME_SOURCE_KINDS as readonly string[]).includes(normalized)) {
    return normalized as TuiResumeSourceKind
  }
  throw new Error(`${label} must be one of: ${RESUME_SOURCE_KINDS.join(', ')}.`)
}

const EXPORT_FORMATS = ['json', 'yaml'] as const satisfies ReadonlyArray<'json' | 'yaml'>

const expectExportFormat = (value: unknown, label: string): 'json' | 'yaml' => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${EXPORT_FORMATS.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((EXPORT_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as 'json' | 'yaml'
  }
  throw new Error(`${label} must be one of: ${EXPORT_FORMATS.join(', ')}.`)
}

const SCRAPE_OUTPUT_FORMATS = ['markdown', 'html', 'json'] as const

const expectScrapeOutputFormat = (value: unknown, label: string): ScrapeOutputFormat => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of: ${SCRAPE_OUTPUT_FORMATS.join(', ')}.`)
  }
  const normalized = value.trim().toLowerCase()
  if ((SCRAPE_OUTPUT_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as ScrapeOutputFormat
  }
  throw new Error(`${label} must be one of: ${SCRAPE_OUTPUT_FORMATS.join(', ')}.`)
}

const expectPuppeteerHeadless = (value: unknown, label: string): PuppeteerHeadlessMode => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'new') {
      return 'new'
    }
    if (normalized === 'true') {
      return true
    }
    if (normalized === 'false') {
      return false
    }
  }
  throw new Error(`${label} must be a boolean or "new".`)
}

const expectProvider = (value: unknown, label: string): ModelProvider => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of openai, gemini, or other.`)
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'openai' || normalized === 'gemini' || normalized === 'other') {
    return normalized as ModelProvider
  }
  throw new Error(`${label} must be one of openai, gemini, or other.`)
}

const expectString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  return value
}

const expectThemeMode = (value: unknown, label: string): ThemeMode => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be one of light, dark, system, or auto.`)
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto') {
    return 'system'
  }
  if (normalized === 'light' || normalized === 'dark' || normalized === 'system') {
    return normalized as ThemeMode
  }
  throw new Error(`${label} must be one of light, dark, system, or auto.`)
}

const expectExampleRating = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error(`${label} must be a number between 1 and 5.`)
  }
  return value
}

type ScrapeEnvOverrides = {
  outputDir?: string
  outputFormat?: ScrapeOutputFormat
  puppeteer?: PuppeteerConfig
}

const parseScrapeEnvOverrides = (): ScrapeEnvOverrides => {
  const outputDir = parseEnvString(process.env.PROMPT_MAKER_SCRAPE_OUTPUT_DIR)
  const outputFormat = parseEnvScrapeOutputFormat(process.env.PROMPT_MAKER_SCRAPE_OUTPUT_FORMAT)

  const puppeteer: PuppeteerConfig = {}

  const headless = parseEnvHeadless(process.env.PUPPETEER_HEADLESS, 'PUPPETEER_HEADLESS')
  if (headless !== undefined) {
    puppeteer.headless = headless
  }

  const navigationTimeoutMs = parseEnvPositiveInteger(
    process.env.PUPPETEER_NAVIGATION_TIMEOUT_MS,
    'PUPPETEER_NAVIGATION_TIMEOUT_MS',
  )
  if (navigationTimeoutMs !== undefined) {
    puppeteer.navigationTimeoutMs = navigationTimeoutMs
  }

  const operationTimeoutMs = parseEnvPositiveInteger(
    process.env.PUPPETEER_OPERATION_TIMEOUT_MS,
    'PUPPETEER_OPERATION_TIMEOUT_MS',
  )
  if (operationTimeoutMs !== undefined) {
    puppeteer.operationTimeoutMs = operationTimeoutMs
  }

  const slowMoMs = parseEnvPositiveInteger(process.env.PUPPETEER_SLOW_MO_MS, 'PUPPETEER_SLOW_MO_MS')
  if (slowMoMs !== undefined) {
    puppeteer.slowMoMs = slowMoMs
  }

  const executablePath = parseEnvString(process.env.PUPPETEER_EXECUTABLE_PATH)
  if (executablePath) {
    puppeteer.executablePath = executablePath
  }

  const args = parseEnvArgs(process.env.PUPPETEER_ARGS)
  if (args.length > 0) {
    puppeteer.args = args
  }

  const userAgent = parseEnvString(process.env.PUPPETEER_USER_AGENT)
  if (userAgent) {
    puppeteer.userAgent = userAgent
  }

  const overrides: ScrapeEnvOverrides = {}

  if (outputDir) {
    overrides.outputDir = outputDir
  }

  if (outputFormat) {
    overrides.outputFormat = outputFormat
  }

  if (Object.keys(puppeteer).length > 0) {
    overrides.puppeteer = puppeteer
  }

  return overrides
}

type SearchWebEnvOverrides = {
  resultsLimit?: number
  proxy?: string
  outputDir?: string
  puppeteer?: PuppeteerConfig
}

const parseSearchWebEnvOverrides = (): SearchWebEnvOverrides => {
  const resultsLimit = parseEnvPositiveInteger(
    process.env.PROMPT_MAKER_SEARCH_WEB_RESULTS_LIMIT,
    'PROMPT_MAKER_SEARCH_WEB_RESULTS_LIMIT',
  )
  const proxy = parseEnvString(process.env.PROMPT_MAKER_SEARCH_WEB_PROXY)
  const outputDir = parseEnvString(process.env.PROMPT_MAKER_SEARCH_WEB_OUTPUT_DIR)

  const puppeteer: PuppeteerConfig = {}

  const headless = parseEnvHeadless(
    process.env.PROMPT_MAKER_SEARCH_WEB_HEADLESS,
    'PROMPT_MAKER_SEARCH_WEB_HEADLESS',
  )
  if (headless !== undefined) {
    puppeteer.headless = headless
  }

  const navigationTimeoutMs = parseEnvPositiveInteger(
    process.env.PROMPT_MAKER_SEARCH_WEB_NAVIGATION_TIMEOUT_MS,
    'PROMPT_MAKER_SEARCH_WEB_NAVIGATION_TIMEOUT_MS',
  )
  if (navigationTimeoutMs !== undefined) {
    puppeteer.navigationTimeoutMs = navigationTimeoutMs
  }

  const operationTimeoutMs = parseEnvPositiveInteger(
    process.env.PROMPT_MAKER_SEARCH_WEB_OPERATION_TIMEOUT_MS,
    'PROMPT_MAKER_SEARCH_WEB_OPERATION_TIMEOUT_MS',
  )
  if (operationTimeoutMs !== undefined) {
    puppeteer.operationTimeoutMs = operationTimeoutMs
  }

  const slowMoMs = parseEnvPositiveInteger(
    process.env.PROMPT_MAKER_SEARCH_WEB_SLOW_MO_MS,
    'PROMPT_MAKER_SEARCH_WEB_SLOW_MO_MS',
  )
  if (slowMoMs !== undefined) {
    puppeteer.slowMoMs = slowMoMs
  }

  const executablePath = parseEnvString(process.env.PROMPT_MAKER_SEARCH_WEB_EXECUTABLE_PATH)
  if (executablePath) {
    puppeteer.executablePath = executablePath
  }

  const args = parseEnvArgs(process.env.PROMPT_MAKER_SEARCH_WEB_ARGS)
  if (args.length > 0) {
    puppeteer.args = args
  }

  const userAgent = parseEnvString(process.env.PROMPT_MAKER_SEARCH_WEB_USER_AGENT)
  if (userAgent) {
    puppeteer.userAgent = userAgent
  }

  const overrides: SearchWebEnvOverrides = {}

  if (resultsLimit !== undefined) {
    overrides.resultsLimit = resultsLimit
  }

  if (proxy) {
    overrides.proxy = proxy
  }

  if (outputDir) {
    overrides.outputDir = outputDir
  }

  if (Object.keys(puppeteer).length > 0) {
    overrides.puppeteer = puppeteer
  }

  return overrides
}

const parseEnvString = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

const parseEnvPositiveInteger = (value: string | undefined, label: string): number | undefined => {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return parsed
}

const parseEnvScrapeOutputFormat = (value: string | undefined): ScrapeOutputFormat | undefined => {
  if (!value) {
    return undefined
  }
  return expectScrapeOutputFormat(value, 'PROMPT_MAKER_SCRAPE_OUTPUT_FORMAT')
}

const parseEnvHeadless = (
  value: string | undefined,
  label: string,
): PuppeteerHeadlessMode | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'new') {
    return 'new'
  }
  if (normalized === 'true' || normalized === '1') {
    return true
  }
  if (normalized === 'false' || normalized === '0') {
    return false
  }

  throw new Error(`${label} must be true, false, or new.`)
}

const parseEnvBoolean = (value: string | undefined, label: string): boolean | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  throw new Error(`${label} must be true or false.`)
}

const resolveHeadlessMode = (config: PromptMakerCliConfig | null): boolean | undefined => {
  const envOverride = parseEnvBoolean(process.env.HELM_HEADLESS, 'HELM_HEADLESS')
  if (envOverride !== undefined) {
    return envOverride
  }
  return config?.headlessMode
}

const parseEnvArgs = (value: string | undefined): string[] => {
  if (!value) {
    return []
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasErrnoCode(value: unknown): value is { code: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    typeof (value as { code: unknown }).code === 'string'
  )
}

function isFileMissingError(error: unknown): boolean {
  return hasErrnoCode(error) && error.code === 'ENOENT'
}
