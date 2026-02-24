import path from 'node:path'

import type {
  ImagePart,
  Message,
  MessageContent,
  PdfPart,
  TextPart,
  ToolCallRequest,
  VideoPart,
} from './types'
import { extractPdfTextFromFile } from './pdf/extract'

export type OpenAIChatMessageContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>

export type OpenAIToolCall = {
  id: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

export type OpenAIChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: OpenAIChatMessageContent
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export type OpenAIResponsesInputText = { type: 'input_text'; text: string }
export type OpenAIResponsesInputImage = { type: 'input_image'; image_url: string }
export type OpenAIResponsesInputContent =
  | string
  | Array<OpenAIResponsesInputText | OpenAIResponsesInputImage>

export type OpenAIResponsesInputMessage = {
  role: 'developer' | 'user' | 'assistant' | 'tool'
  content: OpenAIResponsesInputContent
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export type GeminiContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { mimeType: string; fileUri: string } }

const isVideoPart = (part: TextPart | ImagePart | VideoPart | PdfPart): part is VideoPart => {
  return part.type === 'video_uri'
}

const isPdfPart = (part: TextPart | ImagePart | VideoPart | PdfPart): part is PdfPart => {
  return part.type === 'pdf'
}

export const toOpenAIMessageAsync = async (
  message: Message,
): Promise<OpenAIChatCompletionMessage> => {
  const toolCalls = message.toolCalls ?? message.tool_calls
  const toolCallId = resolveToolCallId(message)
  const normalizedToolCalls = toolCalls
    ? toolCalls
        .map((call, index) => toOpenAIToolCall(call, index))
        .filter((call): call is OpenAIToolCall => Boolean(call))
    : []
  return {
    role: message.role,
    content: await toOpenAIContentAsync(message.content),
    ...(normalizedToolCalls.length > 0 ? { tool_calls: normalizedToolCalls } : {}),
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
  }
}

const toOpenAIContentAsync = async (content: MessageContent): Promise<OpenAIChatMessageContent> => {
  if (typeof content === 'string') {
    return content
  }

  const hasVideo = content.some((part) => isVideoPart(part))
  if (hasVideo) {
    throw new Error(
      'Video inputs are only supported when using Gemini models. Remove --video or switch to a Gemini model.',
    )
  }

  const isAllText = content.every((part) => part.type === 'text')
  if (isAllText) {
    return content.map((part) => ('text' in part ? part.text : '')).join('')
  }

  const parts: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = []

  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text })
      continue
    }

    if (part.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${part.mimeType};base64,${part.data}` },
      })
      continue
    }

    if (isPdfPart(part)) {
      const extracted = await extractPdfTextFromFile(part.filePath)
      if (extracted.ok) {
        const label = path.basename(part.filePath)
        parts.push({ type: 'text', text: `PDF (${label}):\n${extracted.text}` })
      } else {
        parts.push({ type: 'text', text: extracted.message })
      }
      continue
    }

    parts.push({ type: 'text', text: '' })
  }

  return parts
}

export const toOpenAIResponsesInputMessageAsync = async (
  message: Message,
): Promise<OpenAIResponsesInputMessage> => {
  const toolCalls = message.toolCalls ?? message.tool_calls
  const toolCallId = resolveToolCallId(message)
  const normalizedToolCalls = toolCalls
    ? toolCalls
        .map((call, index) => toOpenAIToolCall(call, index))
        .filter((call): call is OpenAIToolCall => Boolean(call))
    : []
  return {
    role: message.role === 'system' ? 'developer' : message.role,
    content: await toOpenAIResponsesContentAsync(message.content),
    ...(normalizedToolCalls.length > 0 ? { tool_calls: normalizedToolCalls } : {}),
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
  }
}

const toOpenAIToolCall = (call: ToolCallRequest, index: number): OpenAIToolCall | null => {
  if ('function' in call) {
    return {
      id: call.id,
      type: 'type' in call && typeof call.type === 'string' ? call.type : 'function',
      function: call.function,
    }
  }

  const name = call.name
  if (!name) {
    return null
  }

  return {
    id: call.id ?? `tool_call_${index + 1}`,
    type: 'type' in call && typeof call.type === 'string' ? call.type : 'function',
    function: {
      name,
      arguments: serializeToolArguments(call.arguments),
    },
  }
}

const serializeToolArguments = (value: unknown): string => {
  if (typeof value === 'string') {
    return value
  }

  if (value === undefined) {
    return '{}'
  }

  try {
    const serialized = JSON.stringify(value)
    return typeof serialized === 'string' ? serialized : '{}'
  } catch {
    return '{}'
  }
}

const resolveToolCallId = (message: Message): string | undefined => {
  const toolCallId = message.toolCallId ?? message.tool_call_id
  if (message.role !== 'tool') {
    return toolCallId
  }

  if (typeof toolCallId === 'string' && toolCallId.trim().length > 0) {
    return toolCallId
  }

  throw new Error('Tool messages require toolCallId for tool call correlation.')
}

const toOpenAIResponsesContentAsync = async (
  content: MessageContent,
): Promise<OpenAIResponsesInputContent> => {
  if (typeof content === 'string') {
    return content
  }

  const hasVideo = content.some((part) => isVideoPart(part))
  if (hasVideo) {
    throw new Error(
      'Video inputs are only supported when using Gemini models. Remove --video or switch to a Gemini model.',
    )
  }

  const isAllText = content.every((part) => part.type === 'text')
  if (isAllText) {
    return content.map((part) => ('text' in part ? part.text : '')).join('')
  }

  const parts: Array<OpenAIResponsesInputText | OpenAIResponsesInputImage> = []

  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'input_text', text: part.text })
      continue
    }

    if (part.type === 'image') {
      parts.push({
        type: 'input_image',
        image_url: `data:${part.mimeType};base64,${part.data}`,
      })
      continue
    }

    if (isPdfPart(part)) {
      const extracted = await extractPdfTextFromFile(part.filePath)
      if (extracted.ok) {
        const label = path.basename(part.filePath)
        parts.push({ type: 'input_text', text: `PDF (${label}):\n${extracted.text}` })
      } else {
        parts.push({ type: 'input_text', text: extracted.message })
      }
      continue
    }

    parts.push({ type: 'input_text', text: '' })
  }

  return parts
}

export const toGeminiParts = (content: MessageContent): GeminiContentPart[] => {
  if (typeof content === 'string') {
    return content ? [{ text: content }] : []
  }

  return content.map((part) => {
    if (part.type === 'text') {
      return { text: part.text }
    }

    if (part.type === 'image') {
      return { inlineData: { mimeType: part.mimeType, data: part.data } }
    }

    if (part.type === 'video_uri') {
      return { fileData: { mimeType: part.mimeType, fileUri: part.fileUri } }
    }

    if (part.type === 'pdf') {
      if (!part.fileUri) {
        throw new Error(
          `PDF attachment ${part.filePath} is missing a Gemini fileUri. ` +
            'Upload the PDF via the Gemini Files API before calling Gemini models.',
        )
      }
      return { fileData: { mimeType: part.mimeType, fileUri: part.fileUri } }
    }

    return { text: '' }
  })
}
