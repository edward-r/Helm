import { useCallback, useEffect, useRef, useState } from 'react'
import { trpcClient } from './trpc'
import type { ExecutorResult, ExecutorRunInput, ExecutorStreamEvent } from '../../shared/trpc'

type Subscription = { unsubscribe: () => void }

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'
const DEFAULT_USER_INTENT = 'Draft a short greeting and list three ideas.'
const DEFAULT_MODEL = 'gpt-5.1-codex'
const DEFAULT_MAX_ITERATIONS = '8'

const formatTimestamp = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString()
}

const formatEventLine = (event: ExecutorStreamEvent): string => {
  const time = formatTimestamp(event.timestamp)

  if (event.event === 'executor.complete') {
    const status = event.result.ok ? 'ok' : 'error'
    const summary = event.result.ok ? 'final response ready' : event.result.error.message
    return `${time} executor.complete (${status}) ${summary}`
  }

  if (event.event === 'thinking') {
    const result = event.result ? ` result=${event.result}` : ''
    const toolNames =
      event.toolNames && event.toolNames.length > 0
        ? ` tools=${event.toolNames.join(', ')}`
        : ''
    return `${time} thinking ${event.phase}${result}${toolNames} - ${event.summary}`
  }

  if (event.event === 'tool_success') {
    return `${time} tool_success ${event.toolName} - ${event.summary}`
  }

  const errorCode = event.errorCode ? ` code=${event.errorCode}` : ''
  return `${time} tool_error ${event.toolName}${errorCode} - ${event.errorMessage}`
}

const normalizeMaxIterations = (value: string): number | undefined => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }
  return parsed
}

function App(): React.JSX.Element {
  const [systemPrompt, setSystemPrompt] = useState<string>(DEFAULT_SYSTEM_PROMPT)
  const [userIntent, setUserIntent] = useState<string>(DEFAULT_USER_INTENT)
  const [model, setModel] = useState<string>(DEFAULT_MODEL)
  const [maxIterations, setMaxIterations] = useState<string>(DEFAULT_MAX_ITERATIONS)
  const [autoApprove, setAutoApprove] = useState<boolean>(false)
  const [events, setEvents] = useState<ExecutorStreamEvent[]>([])
  const [finalResult, setFinalResult] = useState<ExecutorResult | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState<boolean>(false)
  const subscriptionRef = useRef<Subscription | null>(null)

  useEffect(() => {
    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe()
        subscriptionRef.current = null
      }
    }
  }, [])

  const stopStream = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe()
      subscriptionRef.current = null
    }
    setIsStreaming(false)
  }, [])

  const clearStream = useCallback(() => {
    setEvents([])
    setFinalResult(null)
    setStreamError(null)
  }, [])

  const startStream = useCallback(() => {
    if (isStreaming) {
      return
    }

    stopStream()
    clearStream()
    setIsStreaming(true)

    const maxIterationsValue = normalizeMaxIterations(maxIterations)

    const input: ExecutorRunInput = {
      systemPrompt: systemPrompt.trim(),
      userIntent: userIntent.trim(),
      model: model.trim(),
      ...(maxIterationsValue ? { maxIterations: maxIterationsValue } : {}),
      ...(autoApprove ? { autoApprove: true } : {}),
    }

    const subscription = trpcClient.executorStream.subscribe(input, {
      onData: (event) => {
        setEvents((previous) => [...previous, event])
        if (event.event === 'executor.complete') {
          setFinalResult(event.result)
          setIsStreaming(false)
        }
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : 'Unknown error'
        setStreamError(message)
        setIsStreaming(false)
      },
      onComplete: () => {
        setIsStreaming(false)
      },
    })

    subscriptionRef.current = subscription
  }, [
    autoApprove,
    clearStream,
    isStreaming,
    maxIterations,
    model,
    stopStream,
    systemPrompt,
    userIntent,
  ])

  const eventLines = events.map(formatEventLine)
  const canStream =
    systemPrompt.trim().length > 0 && userIntent.trim().length > 0 && model.trim().length > 0

  return (
    <>
      <section className="executor">
        <div className="executor-header">
          <div>
            <div className="executor-title">Executor Stream</div>
            <div className="executor-subtitle">tRPC event feed from the main process</div>
          </div>
          <div className={`executor-status${isStreaming ? ' is-active' : ''}`}>
            {isStreaming ? 'Streaming...' : 'Idle'}
          </div>
        </div>
        <div className="executor-form">
          <label className="executor-field">
            <span>System prompt</span>
            <textarea
              rows={2}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
            />
          </label>
          <label className="executor-field">
            <span>User intent</span>
            <textarea
              rows={3}
              value={userIntent}
              onChange={(event) => setUserIntent(event.target.value)}
            />
          </label>
          <div className="executor-row">
            <label className="executor-field">
              <span>Model</span>
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label className="executor-field">
              <span>Max iterations</span>
              <input
                type="number"
                min="1"
                step="1"
                value={maxIterations}
                onChange={(event) => setMaxIterations(event.target.value)}
              />
            </label>
            <label className="executor-toggle">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(event) => setAutoApprove(event.target.checked)}
              />
              Auto-approve tools
            </label>
          </div>
        </div>
        <div className="executor-actions">
          <button type="button" onClick={startStream} disabled={!canStream || isStreaming}>
            Stream
          </button>
          <button type="button" onClick={stopStream} disabled={!isStreaming}>
            Stop
          </button>
          <button
            type="button"
            onClick={clearStream}
            disabled={isStreaming || (events.length === 0 && !finalResult && !streamError)}
          >
            Clear
          </button>
        </div>
        <div className="executor-output">
          <div className="executor-output-title">Events</div>
          <div className="executor-log">
            {eventLines.length === 0 ? (
              <div className="executor-empty">No events yet.</div>
            ) : (
              eventLines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
            )}
          </div>
        </div>
        <div className="executor-output">
          <div className="executor-output-title">Final result</div>
          <pre className="executor-result">
            {finalResult ? JSON.stringify(finalResult, null, 2) : 'No result yet.'}
          </pre>
        </div>
        {streamError ? <div className="executor-error">Stream error: {streamError}</div> : null}
      </section>
    </>
  )
}

export default App
