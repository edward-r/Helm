import { useCallback, useEffect, useState } from 'react'

import { trpcClient } from '../trpc'
import { useAgentStore } from '../store/useAgentStore'
import { useAppStore } from '../store/useAppStore'

const SettingsModal = () => {
  const isOpen = useAgentStore((state) => state.isSettingsOpen)
  const closeSettings = useAgentStore((state) => state.closeSettings)
  const useVimMode = useAppStore((state) => state.useVimMode)
  const setUseVimMode = useAppStore((state) => state.setUseVimMode)

  const [activeTab, setActiveTab] = useState<'general' | 'models' | 'lsp'>('models')
  const [openaiKey, setOpenaiKey] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [lspOverrides, setLspOverrides] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let active = true
    const loadConfig = async () => {
      try {
        const config = await trpcClient.getConfig.query()
        if (!active) {
          return
        }
        setOpenaiKey(config.openaiKey ?? '')
        setGeminiKey(config.geminiKey ?? '')
        setLspOverrides(config.lspOverrides ?? {})
        setLoadError(null)
      } catch (error) {
        if (!active) {
          return
        }
        const message = error instanceof Error ? error.message : 'Failed to load settings.'
        setLoadError(message)
      }
    }
    void loadConfig()
    return () => {
      active = false
    }
  }, [isOpen])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      const normalizedOverrides = Object.entries(lspOverrides).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          const trimmedKey = key.trim()
          const trimmedValue = value.trim()
          if (trimmedKey && trimmedValue) {
            acc[trimmedKey] = trimmedValue
          }
          return acc
        },
        {}
      )
      await trpcClient.updateConfig.mutate({
        openaiKey,
        geminiKey,
        lspOverrides: normalizedOverrides
      })
      closeSettings()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save settings.'
      setLoadError(message)
    } finally {
      setIsSaving(false)
    }
  }, [closeSettings, geminiKey, lspOverrides, openaiKey])

  if (!isOpen) {
    return null
  }

  return (
    <div className="settings-overlay">
      <div className="settings-panel">
        <div className="settings-header">
          <div>
            <div className="settings-title">Settings</div>
            <div className="settings-subtitle">Configure API keys</div>
          </div>
          <button type="button" className="button is-secondary" onClick={closeSettings}>
            Close
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-nav">
            <button
              type="button"
              className={`settings-tab${activeTab === 'general' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button
              type="button"
              className={`settings-tab${activeTab === 'models' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('models')}
            >
              Models & API Keys
            </button>
            <button
              type="button"
              className={`settings-tab${activeTab === 'lsp' ? ' is-active' : ''}`}
              onClick={() => setActiveTab('lsp')}
            >
              Language Servers
            </button>
          </div>
          <div className="settings-content">
            {activeTab === 'general' ? (
              <label className="input-toggle">
                <input
                  type="checkbox"
                  checked={useVimMode}
                  onChange={(event) => setUseVimMode(event.target.checked)}
                />
                Enable Vim Keybindings
              </label>
            ) : null}
            {activeTab === 'models' ? (
              <>
                <label className="settings-field">
                  <span>OpenAI API Key</span>
                  <input
                    type="password"
                    value={openaiKey}
                    onChange={(event) => setOpenaiKey(event.target.value)}
                    placeholder="sk-..."
                  />
                </label>
                <label className="settings-field">
                  <span>Gemini API Key</span>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(event) => setGeminiKey(event.target.value)}
                    placeholder="AIza..."
                  />
                </label>
              </>
            ) : null}
            {activeTab === 'lsp' ? (
              <>
                <label className="settings-field">
                  <span>TypeScript LSP Path</span>
                  <input
                    type="text"
                    value={lspOverrides.typescript ?? ''}
                    onChange={(event) =>
                      setLspOverrides((prev) => ({
                        ...prev,
                        typescript: event.target.value
                      }))
                    }
                    placeholder="vtsls or /path/to/vtsls"
                  />
                </label>
                <label className="settings-field">
                  <span>Python LSP Path</span>
                  <input
                    type="text"
                    value={lspOverrides.python ?? ''}
                    onChange={(event) =>
                      setLspOverrides((prev) => ({
                        ...prev,
                        python: event.target.value
                      }))
                    }
                    placeholder="pyright-langserver or /path/to/pyright-langserver"
                  />
                </label>
              </>
            ) : null}
          </div>
          {loadError ? <div className="settings-error">{loadError}</div> : null}
        </div>
        <div className="settings-footer">
          <button
            type="button"
            className="button is-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
