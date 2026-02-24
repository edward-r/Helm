export type ThinkingEvent = {
  event: 'thinking'
  phase:
    | 'llm_call_start'
    | 'llm_call_end'
    | 'tool_call_detected'
    | 'tool_plan_built'
    | 'tool_call_error'
  callIndex: number
  iteration: number
  model: string
  result?: 'final_text' | 'tool_calls' | 'error'
  toolNames?: string[]
  errorCode?: string
  durationMs?: number
  summary: string
}

export type ToolSuccessEvent = {
  event: 'tool_success'
  toolName: string
  toolCallId: string
  durationMs: number
  summary: string
  iteration?: number
}

export type ToolErrorEvent = {
  event: 'tool_error'
  toolName: string
  toolCallId: string
  durationMs: number
  summary: string
  errorMessage: string
  errorCode?: string
  iteration?: number
}

export type AgentEvent = ThinkingEvent | ToolSuccessEvent | ToolErrorEvent
