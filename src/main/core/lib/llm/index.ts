import type { LLMResult, Message, ToolDefinition } from './types'
import { callOpenAI, callOpenAIEmbedding } from './providers/openai'
import { callGemini, callGeminiEmbedding } from './providers/gemini'

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? process.env.GEMINI_MODEL ?? 'gpt-5.1-codex'
const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_GEMINI_EMBEDDING_MODEL = 'text-embedding-004'

const resolveProvider = (model: string): 'openai' | 'gemini' => {
  const normalized = model.trim().toLowerCase()
  if (
    normalized.startsWith('gemini') ||
    normalized.startsWith('gemma') ||
    normalized === 'text-embedding-004'
  ) {
    return 'gemini'
  }
  return 'openai'
}

export const callLLM = async (
  messages: Message[],
  model: string = DEFAULT_MODEL,
  tools?: ToolDefinition[],
): Promise<LLMResult> => {
  const provider = resolveProvider(model)

  if (provider === 'gemini') {
    return callGemini(messages, model, tools)
  }

  return callOpenAI(messages, model, tools)
}

export const getEmbedding = async (text: string, model?: string): Promise<number[]> => {
  if (!text || !text.trim()) {
    throw new Error('Text to embed must not be empty.')
  }

  const requestedModel = model?.trim()
  const targetModel =
    requestedModel && requestedModel.length > 0 ? requestedModel : DEFAULT_OPENAI_EMBEDDING_MODEL
  const provider = resolveProvider(targetModel)

  if (provider === 'gemini') {
    const geminiModel =
      requestedModel && requestedModel.length > 0 ? requestedModel : DEFAULT_GEMINI_EMBEDDING_MODEL
    return callGeminiEmbedding(text, geminiModel)
  }

  return callOpenAIEmbedding(text, targetModel)
}
