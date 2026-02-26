import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { trpcClient } from '../trpc'
import type { ModelInfo } from '../../../shared/trpc'
import { useAgentStore } from '../store/useAgentStore'
import { useAppStore } from '../store/useAppStore'
import AutomationWorkspace from './AutomationWorkspace'
import InputPanel from './InputPanel'
import MessageBubble from './MessageBubble'
import ResearchWorkspace from './ResearchWorkspace'
import SettingsModal from './SettingsModal'
import TestPlayground from './TestPlayground'
import TimelineFeed from './TimelineFeed'
import ToolApprovalModal from './ToolApprovalModal'
import ValidationCard from './ValidationCard'

const DEFAULT_MODEL_ID = 'gemini-2.0-flash'

const ModelSelector = () => {
  const selectedModel = useAppStore((state) => state.selectedModel)
  const setSelectedModel = useAppStore((state) => state.setSelectedModel)

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const modelMenuRef = useRef<HTMLDivElement | null>(null)

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
        const configuredModel = config.defaultModel?.trim() || DEFAULT_MODEL_ID
        if (configuredModel) {
          const currentModel = useAppStore.getState().selectedModel
          if (configuredModel !== currentModel) {
            setSelectedModel(configuredModel)
          }
        }
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
  }, [setSelectedModel])

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
    return availableModels.some((item) => item.id === selectedModel)
  }, [availableModels, selectedModel])

  const selectedModelInfo = useMemo(() => {
    return availableModels.find((item) => item.id === selectedModel)
  }, [availableModels, selectedModel])

  const groupedOptions = useMemo(() => {
    if (!selectedModel || hasModelOption || availableModels.length === 0) {
      return modelGroups
    }
    const customModel: ModelInfo = {
      id: selectedModel,
      name: selectedModel,
      provider: 'Custom'
    }
    return [...modelGroups, { provider: 'Custom', models: [customModel] }]
  }, [availableModels.length, hasModelOption, modelGroups, selectedModel])

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

  const formatCapabilityTitle = useCallback(
    (item: ModelInfo): string => {
      const details: string[] = []
      if (item.contextLength) {
        details.push(`${formatContextLength(item.contextLength)} ctx`)
      }
      if (item.toolCall !== undefined) {
        details.push(`tools: ${item.toolCall ? 'yes' : 'no'}`)
      }
      if (item.inputModalities && item.inputModalities.length > 0) {
        details.push(`input: ${item.inputModalities.join(', ')}`)
      }
      return details.length > 0 ? `${item.name} • ${details.join(' • ')}` : item.name
    },
    [formatContextLength]
  )

  const closeModelMenu = useCallback(() => {
    setIsModelMenuOpen(false)
  }, [])

  const toggleModelMenu = useCallback(() => {
    if (!modelsLoaded) {
      return
    }
    setIsModelMenuOpen((value) => !value)
  }, [modelsLoaded])

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

  const selectedName = selectedModelInfo?.name ?? selectedModel
  const selectedTitle = selectedModelInfo ? formatCapabilityTitle(selectedModelInfo) : selectedName

  return (
    <div className="model-selector-container" ref={modelMenuRef}>
      <div className="model-selector-label">Model</div>
      <div className="model-select">
        <button
          type="button"
          className={`model-select-trigger${isModelMenuOpen ? ' is-open' : ''}`}
          onClick={toggleModelMenu}
          disabled={!modelsLoaded}
          aria-expanded={isModelMenuOpen}
          aria-haspopup="listbox"
          title={selectedTitle}
        >
          <div className="model-select-text">
            <div className="model-select-name">
              {modelsLoaded ? selectedName || 'Select model' : 'Loading models...'}
            </div>
          </div>
          <span className="model-select-caret">v</span>
        </button>
        {isModelMenuOpen ? (
          <div className="model-select-menu" role="listbox">
            <div className="model-select-search">
              <input
                type="text"
                placeholder="Search models..."
                value={modelSearch}
                onChange={(event) => setModelSearch(event.target.value)}
                className="model-search-input"
                autoFocus
              />
            </div>
            <div className="model-select-list">
              {modelsLoaded && groupedOptions.length > 0 ? (
                groupedOptions.map((group) => (
                  <div key={group.provider} className="model-select-group">
                    <div className="model-select-group-label">{group.provider}</div>
                    {group.models.map((item) => {
                      const isSelected = item.id === selectedModel
                      const optionLabel = formatCapabilityTitle(item)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`model-select-option${isSelected ? ' is-selected' : ''}`}
                          onClick={() => {
                            setSelectedModel(item.id)
                            closeModelMenu()
                          }}
                          title={optionLabel}
                        >
                          <div className="model-option-name">{optionLabel}</div>
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
          </div>
        ) : null}
      </div>
    </div>
  )
}

const WorkspaceLayout = () => {
  const currentMode = useAppStore((state) => state.currentMode)
  const isStreaming = useAgentStore((state) => state.isStreaming)
  const finalResult = useAgentStore((state) => state.finalResult)
  const streamError = useAgentStore((state) => state.streamError)
  const clearHistory = useAgentStore((state) => state.clearHistory)
  const openSettings = useAgentStore((state) => state.openSettings)
  const setMode = useAppStore((state) => state.setMode)

  const isGenerateMode = currentMode === 'generate'
  const isResearchMode = currentMode === 'research'
  const isAutomationMode = currentMode === 'automation'

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
            onClick={() => setMode('generate')}
          >
            Prompt Studio
          </button>
          <button
            type="button"
            className={`nav-item${isResearchMode ? ' is-active' : ''}`}
            onClick={() => setMode('research')}
          >
            Research Desk
          </button>
          <button
            type="button"
            className={`nav-item${isAutomationMode ? ' is-active' : ''}`}
            onClick={() => setMode('automation')}
          >
            Automation Runner
          </button>
        </div>
        <ModelSelector />
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
        ) : isResearchMode ? (
          <ResearchWorkspace />
        ) : (
          <AutomationWorkspace />
        )}
      </div>
      <ToolApprovalModal />
      <TestPlayground />
      <SettingsModal />
    </div>
  )
}

export default WorkspaceLayout
