import { useAgentStore } from '../store/useAgentStore'
import { useAppStore } from '../store/useAppStore'
import InputPanel from './InputPanel'
import MessageBubble from './MessageBubble'
import ResearchWorkspace from './ResearchWorkspace'
import SettingsModal from './SettingsModal'
import TestPlayground from './TestPlayground'
import TimelineFeed from './TimelineFeed'
import ToolApprovalModal from './ToolApprovalModal'
import ValidationCard from './ValidationCard'

const WorkspaceLayout = () => {
  const currentMode = useAppStore((state) => state.currentMode)
  const isStreaming = useAgentStore((state) => state.isStreaming)
  const finalResult = useAgentStore((state) => state.finalResult)
  const streamError = useAgentStore((state) => state.streamError)
  const model = useAgentStore((state) => state.model)
  const clearHistory = useAgentStore((state) => state.clearHistory)
  const openSettings = useAgentStore((state) => state.openSettings)

  const isGenerateMode = currentMode === 'generate'

  return (
    <div className="app-container">
      <aside className="sidebar">
        <div className="nav-header">
          <div className="nav-title">Precision Studio</div>
          <div className="nav-subtitle">Agent workspace</div>
        </div>
        <div className="nav-section">
          <button
            type="button"
            className={`nav-item${isGenerateMode ? ' is-active' : ''}`}
            onClick={() => useAppStore.getState().setMode('generate')}
          >
            Prompt Studio
          </button>
          <button
            type="button"
            className={`nav-item${!isGenerateMode ? ' is-active' : ''}`}
            onClick={() => useAppStore.getState().setMode('research')}
          >
            Research Desk
          </button>
        </div>
        <div className="nav-footer">Model: {model}</div>
      </aside>
      <div className="app-content">
        {isGenerateMode ? (
          <div className="workspace-layout">
            <main className="workspace-main">
              <header className="workspace-header">
                <div>
                  <div className="workspace-title">Chat Timeline</div>
                  <div className="workspace-subtitle">
                    Polished signals from the executor stream
                  </div>
                </div>
                <div className="workspace-actions">
                  <button type="button" className="button is-secondary" onClick={openSettings}>
                    Settings
                  </button>
                  <button type="button" className="button is-secondary" onClick={clearHistory}>
                    Clear
                  </button>
                  <div className={`status-chip${isStreaming ? ' is-active' : ''}`}>
                    {isStreaming ? 'Streaming' : 'Idle'}
                  </div>
                </div>
              </header>
              <div className="workspace-feed">
                <TimelineFeed />
                {finalResult ? <MessageBubble result={finalResult} /> : null}
                <ValidationCard />
                {streamError ? <div className="error-banner">{streamError}</div> : null}
              </div>
              <InputPanel />
            </main>
          </div>
        ) : (
          <ResearchWorkspace />
        )}
      </div>
      <ToolApprovalModal />
      <TestPlayground />
      <SettingsModal />
    </div>
  )
}

export default WorkspaceLayout
