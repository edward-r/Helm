import type { Dirent } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { JsonSchema } from '@prompt-maker/core'

import { isFsNotFoundError } from '../../generate/fs-utils'
import type { AgentTool } from './tool-types'

export type FsToolErrorCode =
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'IS_A_DIRECTORY'
  | 'PERMISSION_DENIED'
  | 'ALREADY_EXISTS'
  | 'IO_ERROR'

export type FsToolError = {
  ok: false
  error: {
    code: FsToolErrorCode
    message: string
    details: {
      path: string
      operation: 'read_file' | 'list_dir' | 'write_file'
      cause?: {
        code?: string
        message?: string
      }
    }
  }
}

export type ReadFileInput = {
  path: string
  encoding?: BufferEncoding
}

export type ReadFileSuccess = {
  ok: true
  value: {
    path: string
    encoding: BufferEncoding
    content: string
  }
}

export type ReadFileResult = ReadFileSuccess | FsToolError

export type ListDirInput = {
  path: string
}

export type ListDirEntry = {
  name: string
  path: string
  type: 'file' | 'dir' | 'other'
}

export type ListDirSuccess = {
  ok: true
  value: {
    path: string
    entries: ListDirEntry[]
  }
}

export type ListDirResult = ListDirSuccess | FsToolError

export type WriteFileInput = {
  path: string
  content: string
  encoding?: BufferEncoding
  create_dirs?: boolean
}

export type WriteFileSuccess = {
  ok: true
  value: {
    path: string
    encoding: BufferEncoding
    bytes: number
  }
}

export type WriteFileResult = WriteFileSuccess | FsToolError

const DEFAULT_ENCODING: BufferEncoding = 'utf8'
const DEFAULT_CREATE_DIRS = true

const READ_FILE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Read a file from disk with optional encoding.',
  properties: {
    path: {
      type: 'string',
      description: 'Path to the file (relative to cwd or absolute).',
    },
    encoding: {
      type: 'string',
      description: 'Optional encoding (defaults to utf8).',
    },
  },
  required: ['path'],
  additionalProperties: false,
}

const LIST_DIR_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'List directory entries sorted deterministically.',
  properties: {
    path: {
      type: 'string',
      description: 'Path to the directory (relative to cwd or absolute).',
    },
  },
  required: ['path'],
  additionalProperties: false,
}

const WRITE_FILE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Write content to a file, optionally creating parent directories.',
  properties: {
    path: {
      type: 'string',
      description: 'Path to the file (relative to cwd or absolute).',
    },
    content: {
      type: 'string',
      description: 'Content to write to the file.',
    },
    encoding: {
      type: 'string',
      description: 'Optional encoding (defaults to utf8).',
    },
    create_dirs: {
      type: 'boolean',
      description: 'Create parent directories before writing (default: true).',
    },
  },
  required: ['path', 'content'],
  additionalProperties: false,
}

/**
 * Tool: read_file
 * Input: { path: string, encoding?: BufferEncoding }
 * Output: { ok: true, value: { path, encoding, content } }
 *   | { ok: false, error: { code, message, details: { path, operation, cause? } } }
 * Errors: INVALID_PATH, NOT_FOUND, IS_A_DIRECTORY, PERMISSION_DENIED, IO_ERROR
 * Defaults: encoding = utf8, paths resolve relative to process.cwd().
 * Example input: { "path": "README.md" }
 * Example output: { "ok": true, "value": { "path": "/abs/README.md", "encoding": "utf8", "content": "..." } }
 */
const READ_FILE_TOOL: AgentTool = {
  name: 'read_file',
  description: 'Read a file from disk.',
  inputSchema: READ_FILE_SCHEMA,
  execute: async (input: unknown) => {
    return await read_file(normalizeReadFileInput(input))
  },
}

/**
 * Tool: list_dir
 * Input: { path: string }
 * Output: { ok: true, value: { path, entries: [{ name, path, type }] } }
 *   | { ok: false, error: { code, message, details: { path, operation, cause? } } }
 * Errors: INVALID_PATH, NOT_FOUND, NOT_A_DIRECTORY, PERMISSION_DENIED, IO_ERROR
 * Defaults: entries sorted directories first, then files, then other.
 * Example input: { "path": "." }
 * Example output: { "ok": true, "value": { "path": "/abs", "entries": [{ "name": "src", "path": "/abs/src", "type": "dir" }] } }
 */
const LIST_DIR_TOOL: AgentTool = {
  name: 'list_dir',
  description: 'List entries in a directory.',
  inputSchema: LIST_DIR_SCHEMA,
  execute: async (input: unknown) => {
    return await list_dir(normalizeListDirInput(input))
  },
}

/**
 * Tool: write_file
 * Input: { path: string, content: string, encoding?: BufferEncoding, create_dirs?: boolean }
 * Output: { ok: true, value: { path, encoding, bytes } }
 *   | { ok: false, error: { code, message, details: { path, operation, cause? } } }
 * Errors: INVALID_PATH, NOT_FOUND, IS_A_DIRECTORY, PERMISSION_DENIED, IO_ERROR
 * Defaults: encoding = utf8, create_dirs = true, paths resolve relative to process.cwd().
 * Example input: { "path": "generated/note.txt", "content": "hello" }
 * Example output: { "ok": true, "value": { "path": "/abs/generated/note.txt", "encoding": "utf8", "bytes": 5 } }
 */
const WRITE_FILE_TOOL: AgentTool = {
  name: 'write_file',
  description: 'Write content to a file, creating parent directories by default.',
  inputSchema: WRITE_FILE_SCHEMA,
  execute: async (input: unknown) => {
    return await write_file(normalizeWriteFileInput(input))
  },
}

export const fsTools: AgentTool[] = [READ_FILE_TOOL, LIST_DIR_TOOL, WRITE_FILE_TOOL]

export const read_file = async (input: ReadFileInput): Promise<ReadFileResult> => {
  const resolvedPath = resolveInputPath(input.path)
  if (!resolvedPath) {
    return buildError('INVALID_PATH', 'Path must not be empty.', input.path, 'read_file')
  }

  const encoding = input.encoding ?? DEFAULT_ENCODING

  try {
    const content = await fs.readFile(resolvedPath, { encoding })
    return {
      ok: true,
      value: {
        path: resolvedPath,
        encoding,
        content,
      },
    }
  } catch (error) {
    return mapFsError(error, resolvedPath, 'read_file')
  }
}

export const list_dir = async (input: ListDirInput): Promise<ListDirResult> => {
  const resolvedPath = resolveInputPath(input.path)
  if (!resolvedPath) {
    return buildError('INVALID_PATH', 'Path must not be empty.', input.path, 'list_dir')
  }

  try {
    const entries = await fs.readdir(resolvedPath, { withFileTypes: true })
    const mapped = entries.map((entry) => ({
      name: entry.name,
      path: path.join(resolvedPath, entry.name),
      type: toEntryType(entry),
    }))

    mapped.sort(compareEntries)

    return {
      ok: true,
      value: {
        path: resolvedPath,
        entries: mapped,
      },
    }
  } catch (error) {
    return mapFsError(error, resolvedPath, 'list_dir')
  }
}

export const write_file = async (input: WriteFileInput): Promise<WriteFileResult> => {
  const resolvedPath = resolveInputPath(input.path)
  if (!resolvedPath) {
    return buildError('INVALID_PATH', 'Path must not be empty.', input.path, 'write_file')
  }

  const encoding = input.encoding ?? DEFAULT_ENCODING
  const createDirs = input.create_dirs ?? DEFAULT_CREATE_DIRS

  if (createDirs) {
    try {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
    } catch (error) {
      return mapFsError(error, resolvedPath, 'write_file')
    }
  }

  try {
    await fs.writeFile(resolvedPath, input.content, { encoding })
    const bytes = Buffer.byteLength(input.content, encoding)
    return {
      ok: true,
      value: {
        path: resolvedPath,
        encoding,
        bytes,
      },
    }
  } catch (error) {
    return mapFsError(error, resolvedPath, 'write_file')
  }
}

const normalizeReadFileInput = (input: unknown): ReadFileInput => {
  const record = asRecord(input)
  const pathValue = getString(record, 'path') ?? ''
  const encoding = getEncoding(record, 'encoding')
  const normalized: ReadFileInput = { path: pathValue }
  if (encoding) {
    normalized.encoding = encoding
  }
  return normalized
}

const normalizeListDirInput = (input: unknown): ListDirInput => {
  const record = asRecord(input)
  const pathValue = getString(record, 'path') ?? ''
  return { path: pathValue }
}

const normalizeWriteFileInput = (input: unknown): WriteFileInput => {
  const record = asRecord(input)
  const pathValue = getString(record, 'path') ?? ''
  const contentValue = getString(record, 'content') ?? ''
  const encoding = getEncoding(record, 'encoding')
  const createDirs = getBoolean(record, 'create_dirs')
  const normalized: WriteFileInput = { path: pathValue, content: contentValue }
  if (encoding) {
    normalized.encoding = encoding
  }
  if (createDirs !== undefined) {
    normalized.create_dirs = createDirs
  }
  return normalized
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

const getString = (record: Record<string, unknown> | null, key: string): string | undefined => {
  if (!record) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const getBoolean = (record: Record<string, unknown> | null, key: string): boolean | undefined => {
  if (!record) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

const getEncoding = (
  record: Record<string, unknown> | null,
  key: string,
): BufferEncoding | undefined => {
  if (!record) {
    return undefined
  }
  const value = record[key]
  if (typeof value === 'string' && Buffer.isEncoding(value)) {
    return value
  }
  return undefined
}

const resolveInputPath = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  return path.resolve(process.cwd(), trimmed)
}

const toEntryType = (entry: Dirent): ListDirEntry['type'] => {
  if (entry.isDirectory()) {
    return 'dir'
  }
  if (entry.isFile()) {
    return 'file'
  }
  return 'other'
}

const compareEntries = (left: ListDirEntry, right: ListDirEntry): number => {
  const leftRank = entryRank(left.type)
  const rightRank = entryRank(right.type)
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  const leftName = left.name.toLowerCase()
  const rightName = right.name.toLowerCase()
  if (leftName === rightName) {
    return left.name.localeCompare(right.name)
  }
  return leftName.localeCompare(rightName)
}

const entryRank = (type: ListDirEntry['type']): number => {
  if (type === 'dir') {
    return 0
  }
  if (type === 'file') {
    return 1
  }
  return 2
}

const mapFsError = (
  error: unknown,
  resolvedPath: string,
  operation: FsToolError['error']['details']['operation'],
): FsToolError => {
  const code = getFsErrorCode(error)
  const cause = buildCause(error, code)

  if (isFsNotFoundError(error)) {
    return buildError('NOT_FOUND', 'Path does not exist.', resolvedPath, operation, cause)
  }

  if (code === 'ENOTDIR') {
    return buildError('NOT_A_DIRECTORY', 'Path is not a directory.', resolvedPath, operation, cause)
  }

  if (code === 'EISDIR') {
    return buildError('IS_A_DIRECTORY', 'Path is a directory.', resolvedPath, operation, cause)
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return buildError('PERMISSION_DENIED', 'Permission denied.', resolvedPath, operation, cause)
  }

  if (code === 'EEXIST') {
    return buildError('ALREADY_EXISTS', 'Path already exists.', resolvedPath, operation, cause)
  }

  const message = error instanceof Error ? error.message : 'Filesystem operation failed.'
  return buildError('IO_ERROR', message, resolvedPath, operation, cause)
}

const buildError = (
  code: FsToolErrorCode,
  message: string,
  resolvedPath: string,
  operation: FsToolError['error']['details']['operation'],
  cause?: { code?: string; message?: string },
): FsToolError => {
  const details: FsToolError['error']['details'] = {
    path: resolvedPath,
    operation,
  }

  if (cause && (cause.code || cause.message)) {
    details.cause = { ...cause }
  }

  return {
    ok: false,
    error: {
      code,
      message,
      details,
    },
  }
}

const getFsErrorCode = (error: unknown): string | undefined => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code
  }
  return undefined
}

const buildCause = (
  error: unknown,
  code: string | undefined,
): { code?: string; message?: string } | undefined => {
  const message = error instanceof Error ? error.message : undefined
  if (!code && !message) {
    return undefined
  }
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
  }
}
