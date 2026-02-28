import { db } from '../core/db'
import type { SessionMessageRecord, SessionRecord } from '../../shared/trpc'
import { createSessionRouter } from '../../shared/trpc'

const insertSession = db.prepare(
  'INSERT INTO sessions (id, title, persona, created_at, updated_at) VALUES (@id, @title, @persona, @createdAt, @updatedAt)'
)
const insertMessage = db.prepare(
  'INSERT INTO messages (id, session_id, role, content, created_at) VALUES (@id, @sessionId, @role, @content, @createdAt)'
)
const touchSession = db.prepare('UPDATE sessions SET updated_at = @updatedAt WHERE id = @sessionId')
const listSessions = db.prepare(
  'SELECT id, title, persona, created_at, updated_at FROM sessions ORDER BY updated_at DESC'
)
const listMessages = db.prepare(
  'SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = @sessionId ORDER BY created_at ASC'
)

const mergeReasoningIntoContent = (content: string, reasoning?: string): string => {
  if (!reasoning || !reasoning.trim()) {
    return content
  }

  try {
    const parsed = JSON.parse(content) as unknown
    if (isRecord(parsed)) {
      return JSON.stringify({ ...parsed, reasoning })
    }
  } catch {
    // fall through to wrap
  }

  return JSON.stringify({ content, reasoning })
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const sessionRouter = createSessionRouter({
  createSession: async ({ id, title, persona }) => {
    const now = Date.now()
    insertSession.run({ id, title, persona, createdAt: now, updatedAt: now })
    return { success: true }
  },
  saveMessage: async ({ id, sessionId, role, content, reasoning }) => {
    const now = Date.now()
    const contentToStore = mergeReasoningIntoContent(content, reasoning)
    insertMessage.run({ id, sessionId, role, content: contentToStore, createdAt: now })
    touchSession.run({ sessionId, updatedAt: now })
    return { success: true }
  },
  getSessions: async () => {
    return listSessions.all() as SessionRecord[]
  },
  getSessionMessages: async ({ sessionId }) => {
    return listMessages.all({ sessionId }) as SessionMessageRecord[]
  }
})
