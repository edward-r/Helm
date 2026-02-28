import fs from 'node:fs/promises'
import path from 'node:path'
import * as url from 'node:url'

import type { Message } from '@prompt-maker/core'

import { getEmbedding } from '../core/lib/llm'
import { LspManager, sendRequestWithTimeout } from '../core/lib/lsp-manager'
import { indexFiles, searchByEmbedding } from './rag/vector-store'

type SmartContextResult = { xml: string; fileCount: number }

const FILE_PATH_REGEX = /(?:^|[\s"'`(])([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=$|[\s"'`),.;:])/g
const COMPONENT_REGEX = /\b[A-Z][A-Za-z0-9]{2,}\b/g

const SMART_CONTEXT_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py'])
const SMART_CONTEXT_DOC_EXTENSIONS = new Set(['.md'])
const SMART_CONTEXT_CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml'])
const SMART_CONTEXT_IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.nx',
  '.next'
])
const SMART_CONTEXT_IGNORE_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])
const MAX_EMBEDDING_FILE_SIZE = 25 * 1024
const MAX_SEMANTIC_MATCHES = 4

const DOC_HINT_REGEX = /\b(readme|docs?|documentation|changelog|guide|markdown)\b/i
const CONFIG_HINT_REGEX =
  /\b(config|configuration|settings|tsconfig|eslint|prettier|package\.json|vite|electron-builder)\b/i

const extractFilePaths = (input: string): string[] => {
  const matches = new Set<string>()
  for (const match of input.matchAll(FILE_PATH_REGEX)) {
    const candidate = match[1]
    if (!candidate) {
      continue
    }
    matches.add(candidate)
  }
  return Array.from(matches)
}

const extractKeywords = (input: string): string[] => {
  const matches = new Set<string>()
  for (const match of input.matchAll(COMPONENT_REGEX)) {
    if (match[0]) {
      matches.add(match[0])
    }
  }
  return Array.from(matches)
}

const isConfigLikeFileName = (entry: string): boolean => {
  const lower = entry.toLowerCase()
  if (lower.startsWith('.')) {
    return true
  }
  if (lower === 'package.json') {
    return true
  }
  if (lower.startsWith('tsconfig')) {
    return true
  }
  if (lower.includes('eslint') || lower.includes('prettier')) {
    return true
  }
  if (lower.includes('electron-builder')) {
    return true
  }
  if (lower.includes('.config.')) {
    return true
  }
  if (lower.includes('vite.config') || lower.includes('electron.vite.config')) {
    return true
  }
  return false
}

const resolveSemanticExtensions = (
  userIntent: string,
  filePaths: string[]
): { extensions: Set<string>; includeConfig: boolean } => {
  const normalized = userIntent.toLowerCase()
  const allowed = new Set(SMART_CONTEXT_CODE_EXTENSIONS)
  const hasDocPath = filePaths.some((filePath) => filePath.toLowerCase().endsWith('.md'))
  const hasConfigPath = filePaths.some((filePath) =>
    ['.json', '.yaml', '.yml', '.toml'].some((ext) => filePath.toLowerCase().endsWith(ext))
  )
  const includeDocs = hasDocPath || DOC_HINT_REGEX.test(normalized)
  const includeConfig = hasConfigPath || CONFIG_HINT_REGEX.test(normalized)

  if (includeDocs) {
    for (const ext of SMART_CONTEXT_DOC_EXTENSIONS) {
      allowed.add(ext)
    }
  }

  if (includeConfig) {
    for (const ext of SMART_CONTEXT_CONFIG_EXTENSIONS) {
      allowed.add(ext)
    }
  }

  return { extensions: allowed, includeConfig }
}

const resolveFilePath = (candidate: string): string => {
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate)
}

const toFileEntry = (filePath: string, content: string): string => {
  return `<file path="${filePath}">\n${content}\n</file>`
}

const findLspAnchorFile = async (candidates: string[]): Promise<string | null> => {
  const fallbackCandidates = [
    ...candidates,
    'src/renderer/src/main.tsx',
    'src/main/index.ts',
    'src/shared/trpc.ts'
  ]
  for (const candidate of fallbackCandidates) {
    const resolved = resolveFilePath(candidate)
    try {
      const stat = await fs.stat(resolved)
      if (stat.isFile()) {
        return resolved
      }
    } catch {
      continue
    }
  }
  return null
}

const scanSmartContextFiles = async (
  baseDir: string,
  allowedExtensions: Set<string>,
  allowConfigFiles: boolean
): Promise<string[]> => {
  const results: string[] = []
  const stack: string[] = [baseDir]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }

    let entries: string[] = []
    try {
      entries = await fs.readdir(current)
    } catch {
      continue
    }

    for (const entry of entries) {
      const absolutePath = path.join(current, entry)
      let stat: { isDirectory: () => boolean; isFile: () => boolean } | null = null
      try {
        stat = await fs.stat(absolutePath)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        if (!SMART_CONTEXT_IGNORE_DIRS.has(entry)) {
          stack.push(absolutePath)
        }
        continue
      }

      if (!stat.isFile()) {
        continue
      }

      if (SMART_CONTEXT_IGNORE_FILES.has(entry) || entry === 'AGENTS.md') {
        continue
      }

      if (!allowConfigFiles && isConfigLikeFileName(entry)) {
        continue
      }

      const ext = path.extname(entry).toLowerCase()
      if (!allowedExtensions.has(ext)) {
        continue
      }

      results.push(absolutePath)
    }
  }

  return Array.from(new Set(results.map((filePath) => path.resolve(filePath))))
}

const filterSmallFiles = async (files: string[]): Promise<string[]> => {
  const results = await Promise.allSettled(
    files.map(async (filePath) => {
      const stats = await fs.stat(filePath)
      return stats.size < MAX_EMBEDDING_FILE_SIZE ? filePath : null
    })
  )
  return results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}

const toDisplayPath = (absolutePath: string): string => {
  const cwd = process.cwd()
  const relative = path.relative(cwd, absolutePath)
  if (!relative || relative.startsWith('..')) {
    return absolutePath
  }
  return relative
}

const formatWorkspaceSymbols = (symbols: unknown): string => {
  if (!Array.isArray(symbols)) {
    return ''
  }

  const lines: string[] = []
  const limit = 25
  for (const entry of symbols.slice(0, limit)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name : 'unknown'
    const kind = typeof record.kind === 'number' ? record.kind : undefined
    const location = record.location as
      | { uri?: string; range?: { start?: { line?: number; character?: number } } }
      | undefined
    const uri = location?.uri
    const start = location?.range?.start
    let locationText = uri ?? ''
    if (uri) {
      try {
        locationText = url.fileURLToPath(uri)
      } catch {
        locationText = uri
      }
    }
    if (typeof start?.line === 'number') {
      const line = start.line + 1
      const col = typeof start.character === 'number' ? start.character + 1 : undefined
      locationText = `${locationText}:${line}${col ? `:${col}` : ''}`
    }
    lines.push(`- ${name}${kind ? ` (kind ${kind})` : ''} @ ${locationText}`)
  }

  return lines.join('\n')
}

export const gatherSmartContext = async (
  userIntent: string,
  history?: Message[],
  modelId?: string
): Promise<SmartContextResult> => {
  const contextEntries: string[] = []
  const filePaths = extractFilePaths(userIntent)
  const keywords = extractKeywords(userIntent)
  const resolvedFiles = new Set<string>()
  const { extensions: semanticExtensions, includeConfig } = resolveSemanticExtensions(
    userIntent,
    filePaths
  )

  for (const filePath of filePaths) {
    const resolved = resolveFilePath(filePath)
    try {
      const stat = await fs.stat(resolved)
      if (!stat.isFile()) {
        continue
      }
      const contents = await fs.readFile(resolved, 'utf8')
      const relativePath = path.relative(process.cwd(), resolved) || resolved
      contextEntries.push(toFileEntry(relativePath, contents))
      resolvedFiles.add(relativePath)
    } catch {
      continue
    }
  }

  const anchorFile = await findLspAnchorFile(Array.from(resolvedFiles))
  if (anchorFile && keywords.length > 0) {
    try {
      const connection = await LspManager.getServer(anchorFile)
      await LspManager.openDocument(connection, anchorFile)

      for (const keyword of keywords) {
        const symbols = await sendRequestWithTimeout(
          connection,
          'workspace/symbol',
          { query: keyword },
          10000
        )
        const formatted = formatWorkspaceSymbols(symbols)
        if (formatted) {
          contextEntries.push(toFileEntry(`workspace-symbols:${keyword}`, formatted))
        }
      }
    } catch {
      // Ignore LSP failures; context gathering should be best-effort.
    }
  }

  const baseDir = process.cwd()
  let intentVector: number[] | null = null
  try {
    intentVector = await getEmbedding(userIntent, modelId)
  } catch {
    intentVector = null
  }

  if (intentVector) {
    const scanFiles = await scanSmartContextFiles(baseDir, semanticExtensions, includeConfig)
    const validFiles = await filterSmallFiles(scanFiles)
    if (validFiles.length > 0) {
      try {
        await indexFiles(validFiles)
        const relatedPaths = await searchByEmbedding(intentVector, MAX_SEMANTIC_MATCHES, validFiles)
        for (const filePath of relatedPaths) {
          if (path.basename(filePath) === 'AGENTS.md') {
            continue
          }
          const displayPath = toDisplayPath(filePath)
          if (resolvedFiles.has(displayPath)) {
            continue
          }
          try {
            const content = await fs.readFile(filePath, 'utf8')
            contextEntries.push(toFileEntry(displayPath, content))
            resolvedFiles.add(displayPath)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown file read error.'
            console.warn(`Warning: Failed to read semantic context file ${filePath}: ${message}`)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown semantic search error.'
        console.warn(`Semantic context search failed: ${message}`)
      }
    }
  }

  void history

  return { xml: contextEntries.join('\n\n'), fileCount: contextEntries.length }
}
