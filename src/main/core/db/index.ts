import path from 'node:path'

import Database from 'better-sqlite3'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { app } from 'electron'

const dbPath = path.join(app.getPath('userData'), 'helm-history.db')
const db: BetterSqliteDatabase = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    persona TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`)

export { db }
