import { useCallback } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { trpcClient } from '../trpc'
import { useAgentStore } from '../store/useAgentStore'

const InputPanel = () => {
  const userIntent = useAgentStore((state) => state.userIntent)
  const systemPrompt = useAgentStore((state) => state.systemPrompt)
  const model = useAgentStore((state) => state.model)
  const maxIterations = useAgentStore((state) => state.maxIterations)
  const autoApprove = useAgentStore((state) => state.autoApprove)
  const attachments = useAgentStore((state) => state.attachments)
  const isStreaming = useAgentStore((state) => state.isStreaming)
  const streamError = useAgentStore((state) => state.streamError)
  const setUserIntent = useAgentStore((state) => state.setUserIntent)
  const setSystemPrompt = useAgentStore((state) => state.setSystemPrompt)
  const setModel = useAgentStore((state) => state.setModel)
  const setMaxIterations = useAgentStore((state) => state.setMaxIterations)
  const setAutoApprove = useAgentStore((state) => state.setAutoApprove)
  const addAttachments = useAgentStore((state) => state.addAttachments)
  const removeAttachment = useAgentStore((state) => state.removeAttachment)
  const executeIntent = useAgentStore((state) => state.executeIntent)
  const stopExecution = useAgentStore((state) => state.stopExecution)

  const canSubmit = userIntent.trim().length > 0 && !isStreaming

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (canSubmit) {
        executeIntent()
      }
    },
    [canSubmit, executeIntent],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!isStreaming) {
          executeIntent()
        }
      }
    },
    [executeIntent, isStreaming],
  )

  const handleAttach = useCallback(async () => {
    try {
      const result = await trpcClient.selectFiles.query()
      if (result.length > 0) {
        addAttachments(result)
      }
    } catch (error) {
      console.error(error)
    }
  }, [addAttachments])

  const getAttachmentName = useCallback((filePath: string) => {
    const parts = filePath.split(/[/\\]/)
    return parts[parts.length - 1] ?? filePath
  }, [])

  return (
    <form className="input-panel" onSubmit={handleSubmit}>
      <div className="input-header">
        <div>
          <div className="input-title">Your intent</div>
          <div className="input-subtitle">Describe what you want the agent to generate.</div>
        </div>
        <div className="input-status">{isStreaming ? 'Running' : 'Ready'}</div>
      </div>
      {attachments.length > 0 ? (
        <div className="attachment-list">
          {attachments.map((filePath) => (
            <div key={filePath} className="attachment-chip">
              <span>{getAttachmentName(filePath)}</span>
              <button
                type="button"
                className="attachment-remove"
                onClick={() => removeAttachment(filePath)}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        className="input-textarea"
        rows={4}
        placeholder="Ask for a plan, write a spec, draft code changes, or gather research..."
        value={userIntent}
        onChange={(event) => setUserIntent(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="input-actions">
        <div className="input-meta">
          <label className="input-field">
            <span>Model</span>
            <input value={model} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label className="input-field">
            <span>Max iterations</span>
            <input
              type="number"
              min="1"
              step="1"
              value={maxIterations}
              onChange={(event) => setMaxIterations(event.target.value)}
            />
          </label>
        </div>
        <div className="input-buttons">
          {isStreaming ? (
            <button type="button" className="button is-secondary" onClick={stopExecution}>
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="button is-secondary"
            onClick={() => void handleAttach()}
            disabled={isStreaming}
          >
            Attach Files
          </button>
          <button type="submit" className="button is-primary" disabled={!canSubmit}>
            Generate
          </button>
        </div>
      </div>
      <details className="input-advanced">
        <summary>Advanced settings</summary>
        <div className="input-advanced-grid">
          <label className="input-field">
            <span>System prompt</span>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>
          <label className="input-toggle">
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={(event) => setAutoApprove(event.target.checked)}
            />
            Auto-approve tools
          </label>
        </div>
      </details>
      {streamError ? <div className="input-error">{streamError}</div> : null}
    </form>
  )
}

export default InputPanel
