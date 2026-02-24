import { useAgentStore } from '../store/useAgentStore'
import InputPanel from './InputPanel'
import MessageBubble from './MessageBubble'
import TimelineFeed from './TimelineFeed'

const WorkspaceLayout = () => {
  const isStreaming = useAgentStore((state) => state.isStreaming)
  const finalResult = useAgentStore((state) => state.finalResult)
  const streamError = useAgentStore((state) => state.streamError)
  const model = useAgentStore((state) => state.model)

  return (
    <div className="workspace-layout">
      <aside className="workspace-nav">
        <div className="nav-header">
          <div className="nav-title">Precision Studio</div>
          <div className="nav-subtitle">Agent workspace</div>
        </div>
        <div className="nav-section">
          <button type="button" className="nav-item is-active">
            Composer
          </button>
          <button type="button" className="nav-item" disabled>
            Research
          </button>
          <button type="button" className="nav-item" disabled>
            Automations
          </button>
        </div>
        <div className="nav-footer">Model: {model}</div>
      </aside>
      <main className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-title">Chat Timeline</div>
            <div className="workspace-subtitle">
              Polished signals from the executor stream
            </div>
          </div>
          <div className={`status-chip${isStreaming ? ' is-active' : ''}`}>
            {isStreaming ? 'Streaming' : 'Idle'}
          </div>
        </header>
        <div className="workspace-feed">
          <TimelineFeed />
          {finalResult ? <MessageBubble result={finalResult} /> : null}
          {streamError ? <div className="error-banner">{streamError}</div> : null}
        </div>
        <InputPanel />
      </main>
    </div>
  )
}

export default WorkspaceLayout
