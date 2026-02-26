import { useCallback } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { useResearchStore } from '../store/useResearchStore'
import MessageBubble from './MessageBubble'
import TimelineFeed from './TimelineFeed'

const ResearchWorkspace = () => {
  const topic = useResearchStore((state) => state.topic)
  const setTopic = useResearchStore((state) => state.setTopic)
  const events = useResearchStore((state) => state.events)
  const finalDossier = useResearchStore((state) => state.finalDossier)
  const isStreaming = useResearchStore((state) => state.isStreaming)
  const streamError = useResearchStore((state) => state.streamError)
  const executeResearch = useResearchStore((state) => state.executeResearch)

  const canSubmit = topic.trim().length > 0 && !isStreaming

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (canSubmit) {
        executeResearch()
      }
    },
    [canSubmit, executeResearch]
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (canSubmit) {
          executeResearch()
        }
      }
    },
    [canSubmit, executeResearch]
  )

  return (
    <div className="workspace-layout">
      <header className="workspace-header">
        <div>
          <div className="workspace-title">Research Desk</div>
          <div className="workspace-subtitle">Live web research with citations.</div>
        </div>
        <div className={`status-chip${isStreaming ? ' is-active' : ''}`}>
          {isStreaming ? 'Streaming' : 'Idle'}
        </div>
      </header>
      <form className="research-panel" onSubmit={handleSubmit}>
        <label className="research-field">
          <span>Topic</span>
          <textarea
            rows={4}
            placeholder="What would you like to research?"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
        </label>
        <div className="research-actions">
          <button type="submit" className="button is-primary" disabled={!canSubmit}>
            Compile Dossier
          </button>
        </div>
      </form>
      <div className="workspace-feed">
        <TimelineFeed events={events} userIntent={topic} isStreaming={isStreaming} />
        {finalDossier ? <MessageBubble result={finalDossier} /> : null}
        {streamError ? <div className="error-banner">{streamError}</div> : null}
      </div>
    </div>
  )
}

export default ResearchWorkspace
