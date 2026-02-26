import { useCallback, useEffect, useState } from 'react'

import { useAppStore } from '../store/useAppStore'
import CodeEditor from './CodeEditor'

const FocusEditorModal = () => {
  const focusEditor = useAppStore((state) => state.focusEditor)
  const closeFocusEditor = useAppStore((state) => state.closeFocusEditor)

  const [draft, setDraft] = useState(focusEditor?.content ?? '')

  useEffect(() => {
    setDraft(focusEditor?.content ?? '')
  }, [focusEditor])

  const handleSave = useCallback(() => {
    if (!focusEditor) {
      return
    }
    focusEditor.onSave(draft)
    closeFocusEditor()
  }, [closeFocusEditor, draft, focusEditor])

  const handleEditorSave = useCallback(
    (newText: string) => {
      if (!focusEditor) {
        return
      }
      focusEditor.onSave(newText)
      closeFocusEditor()
    },
    [closeFocusEditor, focusEditor]
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
            <button type="button" className="button is-primary" onClick={handleSave}>
              Save
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
