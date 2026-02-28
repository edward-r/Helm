import { useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ExecutorResult } from '../../../shared/trpc'
import { useTestStore } from '../store/useTestStore'
import { useAgentStore } from '../store/useAgentStore'
import { useAppStore } from '../store/useAppStore'

type MessageBubbleProps = {
  result: ExecutorResult
}

const resolveMessageBody = (result: ExecutorResult): string => {
  if (result.ok) {
    return result.value.text
  }
  return result.error.message
}

const resolveMessageMeta = (result: ExecutorResult): string | null => {
  if (result.ok) {
    return null
  }
  return result.error.code
}

const MessageBubble = ({ result }: MessageBubbleProps) => {
  const body = resolveMessageBody(result)
  const meta = resolveMessageMeta(result)
  const statusClass = result.ok ? 'is-success' : 'is-error'
  const title = result.ok ? 'Assistant' : 'Execution Error'
  const promptText = result.ok ? result.value.text : ''
  const normalizeReasoning = (value: string | undefined): string => {
    if (!value) {
      return ''
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return ''
    }
    const lowered = trimmed.toLowerCase()
    if (['auto', 'short', 'detailed', 'none', 'full'].includes(lowered)) {
      return ''
    }
    return trimmed
  }

  const reasoning = result.ok
    ? normalizeReasoning(
        [...result.value.messages].reverse().find((message) => message.role === 'assistant')
          ?.reasoning ?? result.value.reasoning
      )
    : ''

  const handleCopy = useCallback(() => {
    if (!promptText) {
      return
    }
    void navigator.clipboard?.writeText(promptText)
  }, [promptText])

  const handleExport = useCallback(() => {
    if (!promptText) {
      return
    }
    const blob = new Blob([promptText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    link.href = url
    link.download = `prompt-${timestamp}.md`
    link.click()
    URL.revokeObjectURL(url)
  }, [promptText])

  const handleTest = useCallback(() => {
    if (!promptText) {
      return
    }
    useTestStore.getState().openPlayground(promptText)
  }, [promptText])

  const handleEditToggle = useCallback(() => {
    if (!result.ok) {
      return
    }
    const content = result.value.text
    useAppStore.getState().openFocusEditor(content, (newText) => {
      useAgentStore.setState((state) => {
        const nextHistory = [...state.chatHistory]
        for (let i = nextHistory.length - 1; i >= 0; i -= 1) {
          const message = nextHistory[i]
          if (message?.role === 'assistant') {
            nextHistory[i] = { ...message, content: newText }
            break
          }
        }
        const nextFinalResult = state.finalResult?.ok
          ? { ...state.finalResult, value: { ...state.finalResult.value, text: newText } }
          : state.finalResult
        return { chatHistory: nextHistory, finalResult: nextFinalResult }
      })
    })
  }, [result])

  return (
    <div className={`message-bubble ${statusClass}`}>
      <div className="message-title">
        {title}
        {meta ? <span className="message-meta">{meta}</span> : null}
      </div>
      {result.ok ? (
        <div className="message-actions">
          <button type="button" className="button is-secondary" onClick={handleCopy}>
            Copy
          </button>
          <button type="button" className="button is-secondary" onClick={handleExport}>
            Export
          </button>
          <button type="button" className="button is-primary" onClick={handleTest}>
            Test Prompt
          </button>
          <button type="button" className="button is-secondary" onClick={handleEditToggle}>
            Edit / Source
          </button>
        </div>
      ) : null}
      {reasoning ? (
        <details className="mb-4 bg-slate-800/50 rounded-md border border-slate-700 overflow-hidden">
          <summary className="px-4 py-2 cursor-pointer text-sm text-slate-400 hover:text-slate-300 font-medium select-none flex items-center">
            <span className="mr-2">🧠</span>
            View AI Reasoning
          </summary>
          <div className="p-4 border-t border-slate-700 text-sm text-slate-300 italic whitespace-pre-wrap">
            {reasoning}
          </div>
        </details>
      ) : null}
      <div className="message-body markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
    </div>
  )
}

export default MessageBubble
