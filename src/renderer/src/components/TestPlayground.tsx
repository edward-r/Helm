import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Message } from '../../../shared/trpc'
import { useAgentStore } from '../store/useAgentStore'
import { useTestStore } from '../store/useTestStore'

const resolveMessageText = (message: Message): string => {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content
    .map((part) => {
      if ('text' in part && typeof part.text === 'string') {
        return part.text
      }
      return ''
    })
    .join('')
}

const TestPlayground = () => {
  const isOpen = useTestStore((state) => state.isOpen)
  const chatHistory = useTestStore((state) => state.chatHistory)
  const isStreaming = useTestStore((state) => state.isStreaming)
  const streamError = useTestStore((state) => state.streamError)
  const closePlayground = useTestStore((state) => state.closePlayground)
  const clearTestHistory = useTestStore((state) => state.clearTestHistory)
  const runTest = useTestStore((state) => state.runTest)
  const model = useAgentStore((state) => state.model)

  const [inputValue, setInputValue] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scrollRef.current) {
      return
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [chatHistory, isStreaming])

  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) {
      return
    }
    runTest(inputValue, model)
    setInputValue('')
  }, [inputValue, isStreaming, model, runTest])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      handleSend()
    },
    [handleSend]
  )

  if (!isOpen) {
    return null
  }

  return (
    <div className="test-playground-overlay">
      <div className="test-playground-panel">
        <div className="test-playground-header">
          <div>
            <div className="test-playground-title">Prompt Playground</div>
            <div className="test-playground-subtitle">System prompt loaded</div>
          </div>
          <div className="test-playground-actions">
            <button type="button" className="button is-secondary" onClick={clearTestHistory}>
              Clear Chat
            </button>
            <button type="button" className="button is-secondary" onClick={closePlayground}>
              Close
            </button>
          </div>
        </div>
        <div ref={scrollRef} className="test-playground-messages">
          {chatHistory.map((message, index) => {
            if (message.role === 'assistant') {
              return (
                <div
                  key={`assistant-${index}`}
                  className="test-message test-message-assistant markdown-body"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {resolveMessageText(message)}
                  </ReactMarkdown>
                </div>
              )
            }

            if (message.role === 'user') {
              return (
                <div key={`user-${index}`} className="test-message test-message-user">
                  {resolveMessageText(message)}
                </div>
              )
            }

            return null
          })}
          {isStreaming ? (
            <div className="test-message test-message-assistant">Thinking...</div>
          ) : null}
          {streamError ? <div className="test-playground-error">{streamError}</div> : null}
        </div>
        <form className="test-playground-input" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Send a test message..."
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            disabled={isStreaming}
          />
          <button
            type="submit"
            className="button is-primary"
            disabled={!inputValue.trim() || isStreaming}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  )
}

export default TestPlayground
