import type { ExecutorResult } from '../../../shared/trpc'

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

  return (
    <div className={`message-bubble ${statusClass}`}>
      <div className="message-title">
        {title}
        {meta ? <span className="message-meta">{meta}</span> : null}
      </div>
      <div className="message-body">{body}</div>
    </div>
  )
}

export default MessageBubble
