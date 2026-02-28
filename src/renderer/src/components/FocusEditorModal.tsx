import { useCallback, useEffect, useState } from 'react'

import { useAppStore } from '../store/useAppStore'
import { useAgentStore } from '../store/useAgentStore'
import CodeEditor from './CodeEditor'

const FocusEditorModal = () => {
  const focusEditor = useAppStore((state) => state.focusEditor)
  const closeFocusEditor = useAppStore((state) => state.closeFocusEditor)
  const executeIntent = useAgentStore((state) => state.executeIntent)

  const [draft, setDraft] = useState(focusEditor?.content ?? '')

  useEffect(() => {
    setDraft(focusEditor?.content ?? '')
  }, [focusEditor])

  const handleExecute = useCallback(
    (nextText: string) => {
      if (!focusEditor) {
        return
      }
      focusEditor.onSave(nextText)
      void executeIntent(nextText)
      closeFocusEditor()
    },
    [closeFocusEditor, executeIntent, focusEditor]
  )

  const handleSave = useCallback(() => {
    handleExecute(draft)
  }, [draft, handleExecute])

  const handleEditorSave = useCallback(
    (newText: string) => {
      handleExecute(newText)
    },
    [handleExecute]
  )

  if (!focusEditor) {
    return null
  }

  return (
    <div className="focus-editor-overlay">
      <div className="focus-editor-modal">
        <div className="focus-editor-header">
          <div className="focus-editor-title">Edit Content</div>
          <div className="focus-editor-actions">
            <button type="button" className="button is-secondary" onClick={closeFocusEditor}>
              Cancel
            </button>
            <button type="button" className="button is-secondary" onClick={handleSave}>
              Save
            </button>
            <button type="button" className="button is-primary" onClick={handleSave}>
              Execute
            </button>
          </div>
        </div>
        <div className="focus-editor-body">
          <CodeEditor
            value={draft}
            language="markdown"
            onChange={setDraft}
            onSave={handleEditorSave}
          />
        </div>
      </div>
    </div>
  )
}

export default FocusEditorModal
