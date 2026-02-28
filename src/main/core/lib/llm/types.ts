export type TextPart = { type: 'text'; text: string }
export type ImagePart = { type: 'image'; mimeType: string; data: string }
export type VideoPart = { type: 'video_uri'; mimeType: string; fileUri: string }
export type PdfPart = {
  type: 'pdf'
  mimeType: 'application/pdf'
  filePath: string
  fileUri?: string
}

export type MessageContent = string | (TextPart | ImagePart | VideoPart | PdfPart)[]

export type JsonSchema = {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema | JsonSchema[]
  enum?: readonly unknown[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
}

export type ToolDefinition = {
  name: string
  description?: string
  inputSchema: JsonSchema
}

export type ToolCall = {
  id?: string
  name: string
  arguments: unknown
}

export type ToolCallRequest =
  | ToolCall
  | {
      id: string
      type: 'function'
      function: {
        name: string
        arguments: string
      }
    }
  | {
      id: string
      name: string
      arguments: string
      type?: string
    }

export type LLMResult = {
  content: string | null
  toolCalls?: ToolCall[]
  reasoning?: string
}

export type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: MessageContent
  toolCalls?: ToolCallRequest[]
  tool_calls?: ToolCallRequest[]
  toolCallId?: string
  tool_call_id?: string
  reasoning?: string
}
