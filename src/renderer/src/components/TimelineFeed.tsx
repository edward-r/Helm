import { useMemo } from 'react'

import type { ThinkingEvent, ToolErrorEvent, ToolSuccessEvent } from '../../../shared/agent-events'
import type { ExecutorStreamEvent } from '../../../shared/trpc'
import { useAgentStore } from '../store/useAgentStore'

type TimelineItemStatus = 'neutral' | 'active' | 'success' | 'error'

type TimelineItem = {
  id: string
  label: string
  detail?: string
  status: TimelineItemStatus
  timestamp?: string
}

const TOOL_LABELS: Record<string, string> = {
  read_web_page: 'Reading a web page',
  search_web: 'Searching the web',
  read_file: 'Reading a file',
  list_dir: 'Scanning a folder',
  write_file: 'Writing a file',
  generate_image: 'Generating an image',
  analyze_image_to_code: 'Analyzing an image'
}

const formatTimestamp = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString()
}

const formatDuration = (durationMs: number): string => {
  if (!Number.isFinite(durationMs)) {
    return ''
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }
  const seconds = durationMs / 1000
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`
}

const describeThinkingEvent = (event: ThinkingEvent): { label: string; detail: string } => {
  switch (event.phase) {
    case 'llm_call_start':
      return {
        label: 'Analyzing the request',
        detail: `Consulting ${event.model}`
      }
    case 'llm_call_end':
      if (event.result === 'final_text') {
        return { label: 'Drafting response', detail: event.summary }
      }
      if (event.result === 'tool_calls') {
        return { label: 'Selecting tools', detail: event.summary }
      }
      return { label: 'Model response issue', detail: event.summary }
    case 'tool_call_detected':
      return { label: 'Preparing tools', detail: event.summary }
    case 'tool_plan_built':
      return { label: 'Planning tool steps', detail: event.summary }
    case 'tool_call_error':
      return { label: 'Tool call issue', detail: event.summary }
    default:
      return { label: 'Processing', detail: event.summary }
  }
}

const buildThinkingItem = (
  event: ThinkingEvent & { timestamp: string },
  index: number
): TimelineItem => {
  const description = describeThinkingEvent(event)
  const status: TimelineItemStatus = event.phase === 'tool_call_error' ? 'error' : 'active'
  return {
    id: `thinking-${index}-${event.timestamp}`,
    label: description.label,
    detail: description.detail,
    status,
    timestamp: formatTimestamp(event.timestamp)
  }
}

const buildToolSuccessItem = (
  event: ToolSuccessEvent & { timestamp: string },
  index: number
): TimelineItem => {
  const label = TOOL_LABELS[event.toolName] ?? `Running ${event.toolName}`
  const duration = formatDuration(event.durationMs)
  const detail = duration ? `${event.summary} (${duration})` : event.summary
  return {
    id: `tool-success-${index}-${event.timestamp}`,
    label,
    detail,
    status: 'success',
    timestamp: formatTimestamp(event.timestamp)
  }
}

const buildToolErrorItem = (
  event: ToolErrorEvent & { timestamp: string },
  index: number
): TimelineItem => {
  const label = TOOL_LABELS[event.toolName] ?? `Running ${event.toolName}`
  return {
    id: `tool-error-${index}-${event.timestamp}`,
    label,
    detail: event.errorMessage,
    status: 'error',
    timestamp: formatTimestamp(event.timestamp)
  }
}

const mapEventToItem = (event: ExecutorStreamEvent, index: number): TimelineItem | null => {
  if (event.event === 'executor.complete') {
    return {
      id: `complete-${index}-${event.timestamp}`,
      label: event.result.ok ? 'Response ready' : 'Execution ended with errors',
      detail: event.result.ok ? 'Final response assembled.' : event.result.error.message,
      status: event.result.ok ? 'success' : 'error',
      timestamp: formatTimestamp(event.timestamp)
    }
  }

  if (event.event === 'tool_approval_required') {
    return {
      id: `approval-${index}-${event.timestamp}`,
      label: `Approval needed for ${event.toolName}`,
      detail: event.plan.riskReason ?? 'Awaiting approval to proceed.',
      status: 'neutral',
      timestamp: formatTimestamp(event.timestamp)
    }
  }

  if (event.event === 'reasoning') {
    return null
  }

  if (event.event === 'thinking') {
    return buildThinkingItem(event, index)
  }

  if (event.event === 'tool_success') {
    return buildToolSuccessItem(event, index)
  }

  return buildToolErrorItem(event, index)
}

type TimelineFeedProps = {
  events?: ExecutorStreamEvent[]
  userIntent?: string
  isStreaming?: boolean
}

const TimelineFeed = ({ events, userIntent, isStreaming }: TimelineFeedProps) => {
  const agentEvents = useAgentStore((state) => state.events)
  const agentIntent = useAgentStore((state) => state.userIntent)
  const agentStreaming = useAgentStore((state) => state.isStreaming)

  const resolvedEvents = events ?? agentEvents
  const resolvedIntent = userIntent ?? agentIntent
  const resolvedStreaming = isStreaming ?? agentStreaming

  const items = useMemo(() => {
    const timelineItems = resolvedEvents
      .map((event, index) => mapEventToItem(event, index))
      .filter((event): event is TimelineItem => event !== null)

    if (!resolvedIntent.trim()) {
      return timelineItems
    }

    if (timelineItems.length === 0 && !resolvedStreaming) {
      return timelineItems
    }

    const intentItem: TimelineItem = {
      id: 'user-intent',
      label: 'Intent received',
      detail: resolvedIntent.trim(),
      status: 'neutral'
    }

    return [intentItem, ...timelineItems]
  }, [resolvedEvents, resolvedIntent, resolvedStreaming])

  if (items.length === 0) {
    return (
      <div className="timeline-feed">
        <div className="timeline-header">
          <div>
            <div className="timeline-title">Timeline</div>
            <div className="timeline-subtitle">Activity will appear here once you start.</div>
          </div>
        </div>
        <div className="timeline-empty">No activity yet.</div>
      </div>
    )
  }

  return (
    <div className="timeline-feed">
      <div className="timeline-header">
        <div>
          <div className="timeline-title">Timeline</div>
          <div className="timeline-subtitle">Live signals from the agent</div>
        </div>
      </div>
      <div className="timeline-list">
        {items.map((item) => (
          <div key={item.id} className="timeline-item">
            <div className={`timeline-dot is-${item.status}`}>
              <span className="timeline-dot-inner" />
            </div>
            <div className="timeline-content">
              <div className="timeline-label">{item.label}</div>
              {item.detail ? <div className="timeline-detail">{item.detail}</div> : null}
            </div>
            {item.timestamp ? <div className="timeline-time">{item.timestamp}</div> : null}
          </div>
        ))}
      </div>
    </div>
  )
}

export default TimelineFeed
