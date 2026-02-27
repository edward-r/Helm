import fs from 'node:fs'
import path from 'node:path'
import * as url from 'node:url'

import type { JsonSchema } from '@prompt-maker/core'

import { LspManager, sendRequestWithTimeout } from '../../core/lib/lsp-manager'
import type { AgentTool } from './tool-types'

export type LspPositionInput = {
  filePath: string
  line: number
  character: number
}

export type LspDocumentSymbolsInput = {
  filePath: string
}

export type LspToolResponse = unknown

const LSP_POSITION_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Locate a symbol at a position using the LSP server.',
  properties: {
    filePath: {
      type: 'string',
      description: 'Absolute or workspace-relative path to the file.'
    },
    line: {
      type: 'number',
      description: 'Zero-based line number.'
    },
    character: {
      type: 'number',
      description: 'Zero-based character offset.'
    }
  },
  required: ['filePath', 'line', 'character'],
  additionalProperties: false
}

const LSP_DOCUMENT_SYMBOLS_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'List document symbols using the LSP server.',
  properties: {
    filePath: {
      type: 'string',
      description: 'Absolute or workspace-relative path to the file.'
    }
  },
  required: ['filePath'],
  additionalProperties: false
}

export const lsp_go_to_definition = async (input: LspPositionInput): Promise<LspToolResponse> => {
  const resolvedPath = path.resolve(input.filePath)
  const connection = await LspManager.getServer(resolvedPath)
  await LspManager.openDocument(connection, resolvedPath)
  const result = await sendRequestWithTimeout(connection, 'textDocument/definition', {
    textDocument: { uri: `file://${resolvedPath}` },
    position: { line: input.line, character: input.character }
  })
  return enrichLspLocations(result)
}

export const lsp_find_references = async (input: LspPositionInput): Promise<LspToolResponse> => {
  const resolvedPath = path.resolve(input.filePath)
  const connection = await LspManager.getServer(resolvedPath)
  await LspManager.openDocument(connection, resolvedPath)
  const result = await sendRequestWithTimeout(connection, 'textDocument/references', {
    textDocument: { uri: `file://${resolvedPath}` },
    position: { line: input.line, character: input.character },
    context: { includeDeclaration: false }
  })
  return enrichLspLocations(result)
}

export const lsp_document_symbols = async (
  input: LspDocumentSymbolsInput
): Promise<LspToolResponse> => {
  const resolvedPath = path.resolve(input.filePath)
  const connection = await LspManager.getServer(resolvedPath)
  await LspManager.openDocument(connection, resolvedPath)
  return await sendRequestWithTimeout(connection, 'textDocument/documentSymbol', {
    textDocument: { uri: `file://${resolvedPath}` }
  })
}

const LSP_GO_TO_DEFINITION_TOOL: AgentTool = {
  name: 'lsp_go_to_definition',
  description: 'Find the definition location for a symbol at a position.',
  inputSchema: LSP_POSITION_SCHEMA,
  execute: async (input: unknown) => {
    return await lsp_go_to_definition(normalizePositionInput(input))
  }
}

const LSP_FIND_REFERENCES_TOOL: AgentTool = {
  name: 'lsp_find_references',
  description: 'Find references for a symbol at a position.',
  inputSchema: LSP_POSITION_SCHEMA,
  execute: async (input: unknown) => {
    return await lsp_find_references(normalizePositionInput(input))
  }
}

const LSP_DOCUMENT_SYMBOLS_TOOL: AgentTool = {
  name: 'lsp_document_symbols',
  description: 'List document symbols in a file.',
  inputSchema: LSP_DOCUMENT_SYMBOLS_SCHEMA,
  execute: async (input: unknown) => {
    return await lsp_document_symbols(normalizeDocumentSymbolsInput(input))
  }
}

export const lspTools: AgentTool[] = [
  LSP_GO_TO_DEFINITION_TOOL,
  LSP_FIND_REFERENCES_TOOL,
  LSP_DOCUMENT_SYMBOLS_TOOL
]

const enrichLspLocations = (value: unknown): unknown => {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      return item
    }

    const uriValue = item.uri
    const rangeValue = item.range
    if (typeof uriValue !== 'string' || !isRecord(rangeValue) || !isRecord(rangeValue.start)) {
      return item
    }

    const start = rangeValue.start
    const lineValue = start.line
    if (typeof lineValue !== 'number' || !Number.isFinite(lineValue)) {
      return item
    }

    let filePath = ''
    let snippet = ''
    try {
      filePath = url.fileURLToPath(uriValue)
      const fileContents = fs.readFileSync(filePath, 'utf-8')
      const lines = fileContents.split('\n')
      const rawSnippet = lines[lineValue] ?? ''
      snippet = rawSnippet.trim()
    } catch {
      if (!filePath) {
        filePath = uriValue
      }
      snippet = ''
    }

    return { filePath, line: lineValue, snippet }
  })
}

const normalizePositionInput = (input: unknown): LspPositionInput => {
  const record = asRecord(input)
  const filePath = getString(record, 'filePath')
  const line = getNumber(record, 'line')
  const character = getNumber(record, 'character')
  if (!filePath) {
    throw new Error('filePath is required for LSP position requests.')
  }
  if (line === null || character === null) {
    throw new Error('line and character are required for LSP position requests.')
  }
  return { filePath, line, character }
}

const normalizeDocumentSymbolsInput = (input: unknown): LspDocumentSymbolsInput => {
  const record = asRecord(input)
  const filePath = getString(record, 'filePath')
  if (!filePath) {
    throw new Error('filePath is required for LSP document symbols requests.')
  }
  return { filePath }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getString = (record: Record<string, unknown> | null, key: string): string | undefined => {
  if (!record) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const getNumber = (record: Record<string, unknown> | null, key: string): number | null => {
  if (!record) {
    return null
  }
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}
