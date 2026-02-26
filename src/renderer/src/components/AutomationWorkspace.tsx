import { useCallback, useMemo, useState } from 'react'
import { trpcClient } from '../trpc'
import { useAutomationStore } from '../store/useAutomationStore'
import CodeEditor from './CodeEditor'

const statusLabelMap: Record<'pending' | 'running' | 'success' | 'error', string> = {
  pending: 'PEND',
  running: 'RUN',
  success: 'OK',
  error: 'ERR'
}

const inferLanguage = (filePath?: string | null): string => {
  if (!filePath) {
    return 'markdown'
  }
  const extension = filePath.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'rs':
      return 'rust'
    case 'java':
      return 'java'
    case 'c':
    case 'h':
      return 'c'
    case 'cpp':
    case 'cxx':
    case 'hpp':
      return 'cpp'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sh':
    case 'bash':
      return 'shell'
    default:
      return 'markdown'
  }
}

const AutomationWorkspace = () => {
  const files = useAutomationStore((state) => state.files)
  const taskPrompt = useAutomationStore((state) => state.taskPrompt)
  const batchStatus = useAutomationStore((state) => state.batchStatus)
  const results = useAutomationStore((state) => state.results)
  const addFiles = useAutomationStore((state) => state.addFiles)
  const removeFile = useAutomationStore((state) => state.removeFile)
  const clearFiles = useAutomationStore((state) => state.clearFiles)
  const setTaskPrompt = useAutomationStore((state) => state.setTaskPrompt)
  const resetBatch = useAutomationStore((state) => state.resetBatch)
  const runBatch = useAutomationStore((state) => state.runBatch)

  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const canRun = files.length > 0 && taskPrompt.trim().length > 0 && batchStatus !== 'running'

  const handleSelectFiles = useCallback(async () => {
    try {
      const selected = await trpcClient.selectFiles.query()
      if (selected.length === 0) {
        return
      }
      addFiles(selected)
      if (!selectedFile) {
        setSelectedFile(selected[0])
      }
    } catch (error) {
      console.error(error)
    }
  }, [addFiles, selectedFile])

  const handleRun = useCallback(() => {
    if (!canRun) {
      return
    }
    void runBatch()
  }, [canRun, runBatch])

  const selectedOutput = selectedFile ? results[selectedFile]?.output : undefined
  const selectedStatus = selectedFile ? results[selectedFile]?.status : undefined
  const selectedError = selectedFile ? results[selectedFile]?.errorMessage : undefined
  const selectedLanguage = inferLanguage(selectedFile)

  const handleSaveOutput = useCallback(
    async (newText: string) => {
      if (!selectedFile) {
        return
      }
      try {
        await trpcClient.saveFileDirect.mutate({ filePath: selectedFile, content: newText })
        useAutomationStore.setState((state) => {
          const existing = state.results[selectedFile] ?? { status: 'success' }
          return {
            results: {
              ...state.results,
              [selectedFile]: {
                ...existing,
                status: 'success',
                output: newText,
                errorMessage: undefined
              }
            }
          }
        })
        console.info('Saved!')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Save failed.'
        console.error(message)
      }
    },
    [selectedFile]
  )

  const fileItems = useMemo(() => {
    return files.map((filePath) => {
      const status = results[filePath]?.status ?? 'pending'
      const label = statusLabelMap[status]
      const isSelected = filePath === selectedFile
      const name = filePath.split(/[/\\]/).pop() ?? filePath
      return {
        filePath,
        name,
        status,
        label,
        isSelected
      }
    })
  }, [files, results, selectedFile])

  return (
    <div className="workspace-layout">
      <header className="workspace-header">
        <div>
          <div className="workspace-title">Automation Runner</div>
          <div className="workspace-subtitle">Queue files and process them sequentially.</div>
        </div>
        <div className={`status-chip${batchStatus === 'running' ? ' is-active' : ''}`}>
          {batchStatus === 'running'
            ? 'Running'
            : batchStatus === 'completed'
              ? 'Completed'
              : 'Idle'}
        </div>
      </header>
      <div className="automation-container">
        <div className="file-queue">
          <div className="file-queue-header">
            <div>
              <div className="file-queue-title">Queue</div>
              <div className="file-queue-subtitle">{files.length} files</div>
            </div>
            <div className="file-queue-actions">
              <button type="button" className="button is-secondary" onClick={handleSelectFiles}>
                Select Files
              </button>
              <button
                type="button"
                className="button is-secondary"
                onClick={() => {
                  clearFiles()
                  resetBatch()
                  setSelectedFile(null)
                }}
                disabled={files.length === 0}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="file-queue-list">
            {fileItems.length === 0 ? (
              <div className="file-queue-empty">No files selected yet.</div>
            ) : (
              fileItems.map((item) => (
                <div
                  key={item.filePath}
                  className={`file-queue-item${item.isSelected ? ' is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedFile(item.filePath)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelectedFile(item.filePath)
                    }
                  }}
                >
                  <span className={`file-status is-${item.status}`}>{item.label}</span>
                  <span className="file-name">{item.name}</span>
                  <button
                    type="button"
                    className="file-remove"
                    onClick={(event) => {
                      event.stopPropagation()
                      removeFile(item.filePath)
                      if (selectedFile === item.filePath) {
                        setSelectedFile(null)
                      }
                    }}
                    aria-label={`Remove ${item.name}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="automation-detail">
          <div className="automation-card">
            <div className="automation-card-header">
              <div>
                <div className="automation-card-title">Batch Prompt</div>
                <div className="automation-card-subtitle">Applied to every file in the queue.</div>
              </div>
              <button
                type="button"
                className="button is-primary"
                onClick={handleRun}
                disabled={!canRun}
              >
                Run Batch
              </button>
            </div>
            <textarea
              className="automation-textarea"
              rows={5}
              placeholder="Summarize this file and extract key action items."
              value={taskPrompt}
              onChange={(event) => setTaskPrompt(event.target.value)}
              disabled={batchStatus === 'running'}
            />
          </div>
          <div className="automation-card">
            <div className="automation-card-header">
              <div>
                <div className="automation-card-title">Output Preview</div>
                <div className="automation-card-subtitle">
                  {selectedFile
                    ? `Preview for ${selectedFile.split(/[/\\]/).pop()}`
                    : 'Select a file to preview.'}
                </div>
              </div>
              {selectedStatus ? (
                <div className={`file-status-pill is-${selectedStatus}`}>{selectedStatus}</div>
              ) : null}
            </div>
            <div className="automation-output">
              {selectedStatus === 'error' ? (
                <div className="automation-error-preview">
                  {selectedError ?? selectedOutput ?? 'The batch run failed for this file.'}
                </div>
              ) : selectedOutput ? (
                <CodeEditor
                  value={selectedOutput}
                  language={selectedLanguage}
                  onSave={handleSaveOutput}
                />
              ) : (
                <div className="automation-output-empty">No output yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AutomationWorkspace
