import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'

import { trpcClient } from '../trpc'
import { useAgentStore } from '../store/useAgentStore'
import type { ModelInfo } from '../../../shared/trpc'

const InputPanel = () => {
  const userIntent = useAgentStore((state) => state.userIntent)
  const systemPrompt = useAgentStore((state) => state.systemPrompt)
  const model = useAgentStore((state) => state.model)
  const maxIterations = useAgentStore((state) => state.maxIterations)
  const autoApprove = useAgentStore((state) => state.autoApprove)
  const attachments = useAgentStore((state) => state.attachments)
  const hasHistory = useAgentStore((state) => state.chatHistory.length > 0)
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

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const [modelSearch, setModelSearch] = useState('')

  const canSubmit = userIntent.trim().length > 0 && !isStreaming

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (canSubmit) {
        executeIntent()
      }
    },
    [canSubmit, executeIntent]
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!isStreaming) {
          executeIntent()
        }
      }
    },
    [executeIntent, isStreaming]
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

  useEffect(() => {
    let active = true
    const loadModels = async () => {
      try {
        const [modelsResult, config] = await Promise.all([
          trpcClient.getModels.query(),
          trpcClient.getConfig.query()
        ])
        if (!active) {
          return
        }
        setAvailableModels(modelsResult)
        const configuredModel = config.defaultModel?.trim() || 'gemini-2.0-flash'
        setModel(configuredModel)
      } catch (error) {
        if (!active) {
          return
        }
        setAvailableModels([])
      } finally {
        if (active) {
          setModelsLoaded(true)
        }
      }
    }
    void loadModels()
    return () => {
      active = false
    }
  }, [setModel])

  const filteredModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    if (!query) {
      return availableModels
    }
    return availableModels.filter((item) => {
      return item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    })
  }, [availableModels, modelSearch])

  const modelGroups = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>()
    for (const item of filteredModels) {
      const provider = item.provider || 'Other'
      const existing = groups.get(provider) ?? []
      existing.push(item)
      groups.set(provider, existing)
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([provider, models]) => {
        const sorted = [...models].sort((left, right) => left.name.localeCompare(right.name))
        return { provider, models: sorted }
      })
  }, [filteredModels])

  const hasModelOption = useMemo(() => {
    return availableModels.some((item) => item.id === model)
  }, [availableModels, model])

  const selectedModel = useMemo(() => {
    return availableModels.find((item) => item.id === model)
  }, [availableModels, model])

  const groupedOptions = useMemo(() => {
    if (!model || hasModelOption || availableModels.length === 0) {
      return modelGroups
    }
    const customModel: ModelInfo = {
      id: model,
      name: model,
      provider: 'Custom'
    }
    return [...modelGroups, { provider: 'Custom', models: [customModel] }]
  }, [availableModels.length, hasModelOption, model, modelGroups])

  const formatContextLength = useCallback((value?: number): string => {
    if (!value) {
      return ''
    }
    if (value >= 1000000) {
      return `${Math.round(value / 100000) / 10}M`
    }
    if (value >= 1000) {
      return `${Math.round(value / 100) / 10}k`
    }
    return `${value}`
  }, [])

  const normalizeModalities = useCallback((value?: string[]): string[] => {
    if (!value) {
      return []
    }
    const map: Record<string, string> = {
      text: 'text',
      image: 'image',
      audio: 'audio',
      video: 'video',
      pdf: 'pdf',
      document: 'pdf'
    }
    return value
      .map((entry) => entry.trim().toLowerCase())
      .map((entry) => map[entry] ?? entry)
      .filter((entry) => entry.length > 0)
  }, [])

  const renderModalityIcon = useCallback((modality: string, isActive: boolean) => {
    return (
      <span
        key={modality}
        className={`modality-icon is-${modality}${isActive ? ' is-active' : ''}`}
        title={isActive ? `Supports ${modality}` : `No ${modality} input`}
      >
        {modality === 'text' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 4h8M8 4v8"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.4"
            />
          </svg>
        ) : null}
        {modality === 'image' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect
              x="3"
              y="4"
              width="10"
              height="8"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <circle cx="6" cy="7" r="1.1" fill="currentColor" />
            <path
              d="M4.5 10.5l2.2-2.3 2 2 2.2-2.2 1.1 1.1"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
          </svg>
        ) : null}
        {modality === 'audio' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M3 9h2l3 3V4L5 7H3z"
              fill="none"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
            <path
              d="M11 6.5a2.5 2.5 0 0 1 0 3"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
            <path
              d="M12.5 5a4.5 4.5 0 0 1 0 6"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
          </svg>
        ) : null}
        {modality === 'video' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect
              x="3"
              y="4"
              width="10"
              height="8"
              rx="1.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <path d="M7 6.5l3 1.5-3 1.5z" fill="currentColor" />
          </svg>
        ) : null}
        {modality === 'pdf' ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5 3h5l3 3v7H5z"
              fill="none"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
            <path
              d="M10 3v3h3"
              fill="none"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.2"
            />
            <path
              d="M6.5 9h3"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
          </svg>
        ) : null}
      </span>
    )
  }, [])

  const renderModalityIcons = useCallback(
    (value?: string[]) => {
      const normalized = normalizeModalities(value)
      const set = new Set(normalized)
      const order = ['text', 'image', 'audio', 'video', 'pdf']
      return order.map((modality) => renderModalityIcon(modality, set.has(modality)))
    },
    [normalizeModalities, renderModalityIcon]
  )

  const renderToolBadge = useCallback((value?: boolean) => {
    const state = value === true ? 'is-active' : value === false ? 'is-inactive' : 'is-unknown'
    const label = value === false ? 'No tools' : 'Tools'
    return (
      <span className={`model-option-tools ${state}`} title={label}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M9.5 3.5a3 3 0 0 0 3 3l-1.4 1.4-2.3-2.3-4.2 4.2a1 1 0 0 1-1.4-1.4l4.2-4.2-2.3-2.3 1.4-1.4a3 3 0 0 0 3 3z"
            fill="currentColor"
          />
        </svg>
        <span>{label}</span>
      </span>
    )
  }, [])

  const closeModelMenu = useCallback(() => {
    setIsModelMenuOpen(false)
  }, [])

  const toggleModelMenu = useCallback(() => {
    if (isStreaming || !modelsLoaded) {
      return
    }
    setIsModelMenuOpen((value) => !value)
  }, [isStreaming, modelsLoaded])

  useEffect(() => {
    if (!isModelMenuOpen) {
      return
    }
    const handlePointer = (event: MouseEvent) => {
      if (!modelMenuRef.current) {
        return
      }
      if (!modelMenuRef.current.contains(event.target as Node)) {
        closeModelMenu()
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModelMenu()
      }
    }
    window.addEventListener('mousedown', handlePointer)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handlePointer)
      window.removeEventListener('keydown', handleKey)
    }
  }, [closeModelMenu, isModelMenuOpen])

  useEffect(() => {
    if (isStreaming) {
      closeModelMenu()
    }
  }, [closeModelMenu, isStreaming])

  const selectedName = selectedModel?.name ?? model
  const selectedContext = selectedModel?.contextLength
    ? `${formatContextLength(selectedModel.contextLength)} ctx`
    : null

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
        placeholder={
          hasHistory
            ? "How would you like to refine this prompt? (e.g., 'Make it more concise', 'Add a section for JSON output') "
            : 'Ask for a plan, write a spec, draft code changes, or gather research...'
        }
        value={userIntent}
        onChange={(event) => setUserIntent(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="input-actions">
        <div className="input-meta">
          <label className="input-field">
            <span>Model</span>
            <div className="model-selector-container">
              <input
                type="text"
                placeholder="Search models..."
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                onFocus={() => setIsModelMenuOpen(true)}
                className="model-search-input"
                disabled={!modelsLoaded || isStreaming}
              />
              <div className="model-select" ref={modelMenuRef}>
                <button
                  type="button"
                  className={`model-select-trigger${isModelMenuOpen ? ' is-open' : ''}`}
                  onClick={toggleModelMenu}
                  disabled={isStreaming || !modelsLoaded}
                  aria-expanded={isModelMenuOpen}
                  aria-haspopup="listbox"
                >
                  <div className="model-select-text">
                    <div className="model-select-name">
                      {modelsLoaded ? selectedName || 'Select model' : 'Loading models...'}
                    </div>
                    {selectedModel ? (
                      <div className="model-select-meta">
                        {selectedContext ? (
                          <span className="model-select-context">{selectedContext}</span>
                        ) : null}
                        <div className="model-option-icons">
                          {renderModalityIcons(selectedModel.inputModalities)}
                        </div>
                        {renderToolBadge(selectedModel.toolCall)}
                      </div>
                    ) : null}
                  </div>
                  <span className="model-select-caret">v</span>
                </button>
                {isModelMenuOpen ? (
                  <div className="model-select-menu" role="listbox">
                    {modelsLoaded && groupedOptions.length > 0 ? (
                      groupedOptions.map((group) => (
                        <div key={group.provider} className="model-select-group">
                          <div className="model-select-group-label">{group.provider}</div>
                          {group.models.map((item) => {
                            const contextLabel = item.contextLength
                              ? `${formatContextLength(item.contextLength)} ctx`
                              : null
                            const isSelected = item.id === model
                            return (
                              <button
                                key={item.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`model-select-option${isSelected ? ' is-selected' : ''}`}
                                onClick={() => {
                                  setModel(item.id)
                                  closeModelMenu()
                                }}
                              >
                                <div className="model-option-main">
                                  <div className="model-option-name">{item.name}</div>
                                  {contextLabel ? (
                                    <div className="model-option-context">{contextLabel}</div>
                                  ) : null}
                                </div>
                                <div className="model-option-meta">
                                  <div className="model-option-icons">
                                    {renderModalityIcons(item.inputModalities)}
                                  </div>
                                  {renderToolBadge(item.toolCall)}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      ))
                    ) : (
                      <div className="model-select-loading">
                        {modelsLoaded
                          ? modelSearch.trim()
                            ? 'No models match your search.'
                            : 'No models available.'
                          : 'Loading models...'}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
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
            {hasHistory ? 'Refine' : 'Generate'}
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
