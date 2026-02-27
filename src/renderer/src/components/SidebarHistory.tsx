import { useCallback, useEffect } from 'react'

import { useAgentStore } from '../store/useAgentStore'

const SidebarHistory = () => {
  const sessions = useAgentStore((state) => state.sessions)
  const activeSessionId = useAgentStore((state) => state.activeSessionId)
  const loadSessions = useAgentStore((state) => state.loadSessions)
  const loadSessionMessages = useAgentStore((state) => state.loadSessionMessages)
  const startNewSession = useAgentStore((state) => state.startNewSession)

  useEffect(() => {
    void loadSessions()
  }, [loadSessions])

  const formatTimestamp = useCallback((value: number): string => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric'
    }).format(new Date(value))
  }, [])

  return (
    <div className="sessions-panel">
      <button type="button" className="button is-secondary sessions-new" onClick={startNewSession}>
        New Chat
      </button>
      <div className="sessions-list">
        {sessions.length === 0 ? <div className="sessions-empty">No sessions yet.</div> : null}
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId
          return (
            <button
              key={session.id}
              type="button"
              className={`session-item${isActive ? ' is-active' : ''}`}
              onClick={() => loadSessionMessages(session.id)}
            >
              <div className="session-item-title">{session.title}</div>
              <div className="session-item-meta">
                <span>{session.persona}</span>
                <span>{formatTimestamp(session.updated_at)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default SidebarHistory
