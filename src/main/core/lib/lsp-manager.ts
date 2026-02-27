import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import type { MessageConnection } from 'vscode-jsonrpc'
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter
} from 'vscode-jsonrpc/node'

type ServerConfig = {
  command: string
  args: string[]
}

type ServerEntry = {
  connection: MessageConnection
  process: ChildProcessWithoutNullStreams
}

const PROJECT_ROOT_MARKERS = ['.git', 'package.json', 'tsconfig.json', 'pyproject.toml']

export const findProjectRoot = (filePath: string): string => {
  const resolvedPath = path.resolve(filePath)
  const startDir = path.dirname(resolvedPath)
  let currentDir = startDir

  while (true) {
    const hasMarker = PROJECT_ROOT_MARKERS.some((marker) => {
      return fs.existsSync(path.join(currentDir, marker))
    })
    if (hasMarker) {
      return currentDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return startDir
    }
    currentDir = parentDir
  }
}

export const sendRequestWithTimeout = (
  connection: MessageConnection,
  method: string,
  params: unknown,
  timeoutMs: number = 15000
): Promise<unknown> => {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `LSP request ${method} timed out after ${timeoutMs}ms. The server may still be indexing the project.`
          )
        ),
      timeoutMs
    )
  )
  const requestPromise = connection.sendRequest(method, params)
  return Promise.race([requestPromise, timeoutPromise])
}

const serverConfigs: Record<string, ServerConfig> = {
  '.ts': { command: 'vtsls', args: ['--stdio'] },
  '.tsx': { command: 'vtsls', args: ['--stdio'] },
  '.py': { command: 'pyright-langserver', args: ['--stdio'] }
}

const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.py': 'python',
  '.json': 'json'
}

export class LspManager {
  private static readonly servers = new Map<string, ServerEntry>()
  private static readonly openDocuments = new WeakMap<MessageConnection, Set<string>>()

  static async getServer(filePath: string): Promise<MessageConnection> {
    const resolvedPath = path.resolve(filePath)
    const extension = path.extname(resolvedPath)
    const config = serverConfigs[extension]
    if (!config) {
      throw new Error(`No LSP server configured for extension: ${extension || '(none)'}`)
    }

    const projectRoot = findProjectRoot(resolvedPath)
    const cacheKey = `${config.command}:${config.args.join(' ')}:${projectRoot}`
    const existing = LspManager.servers.get(cacheKey)
    if (existing) {
      return existing.connection
    }

    const child = spawn(config.command, config.args, { stdio: 'pipe' })
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin)
    )
    connection.listen()
    await connection.sendRequest('initialize', {
      rootUri: `file://${projectRoot}`,
      capabilities: {
        textDocument: {
          documentSymbol: {},
          references: {},
          definition: {}
        }
      }
    })
    await connection.sendNotification('initialized', {})

    LspManager.servers.set(cacheKey, { connection, process: child })
    return connection
  }

  static async openDocument(connection: MessageConnection, filePath: string): Promise<void> {
    const resolvedPath = path.resolve(filePath)
    const uri = `file://${resolvedPath}`
    const opened = LspManager.openDocuments.get(connection)
    if (opened?.has(uri)) {
      return
    }

    const text = await fs.promises.readFile(resolvedPath, 'utf8')
    const extension = path.extname(resolvedPath).toLowerCase()
    const languageId = LANGUAGE_ID_BY_EXTENSION[extension] ?? 'plaintext'

    await connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text
      }
    })

    if (opened) {
      opened.add(uri)
    } else {
      LspManager.openDocuments.set(connection, new Set([uri]))
    }
  }
}
