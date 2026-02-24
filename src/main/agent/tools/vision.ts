import fs from 'node:fs/promises'
import path from 'node:path'

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { JsonSchema } from '@prompt-maker/core'

import { resolveGeminiCredentials } from '../../config'
import type { AgentTool } from './tool-types'
import { generateImage } from './generate-image'
import type { GenerateImageOptions } from './generate-image'

export { generateImage } from './generate-image'
export type {
  GenerateImageError,
  GenerateImageErrorCode,
  GenerateImageOptions,
  GenerateImageResponse,
  GenerateImageSuccess,
  GeneratedImageFile,
} from './generate-image'

export type AnalyzeImageToCodeSuccess = {
  ok: true
  value: {
    text: string
    model: string
    imagePath: string
    instruction: string
  }
}

export type AnalyzeImageToCodeErrorCode =
  | 'INVALID_INSTRUCTION'
  | 'INVALID_IMAGE_PATH'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_READ_FAILED'
  | 'MISSING_API_KEY'
  | 'API_ERROR'
  | 'NO_TEXT'
  | 'UNKNOWN'

export type AnalyzeImageToCodeError = {
  ok: false
  error: {
    code: AnalyzeImageToCodeErrorCode
    message: string
    details: {
      instruction?: string
      imagePath?: string
      model?: string
    }
  }
}

export type AnalyzeImageToCodeResponse = AnalyzeImageToCodeSuccess | AnalyzeImageToCodeError

const GENERATE_IMAGE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Generate an image from a prompt and optional reference image.',
  properties: {
    prompt: {
      type: 'string',
      description: 'Text prompt describing the desired image.',
    },
    imagePath: {
      type: 'string',
      description: 'Optional path to a local reference image.',
    },
    model: {
      type: 'string',
      description: 'Optional model override for image generation.',
    },
    outputDir: {
      type: 'string',
      description: 'Optional output directory for saved images.',
    },
    responseMimeType: {
      type: 'string',
      description: 'Optional response mime type (e.g. image/png).',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
}

const ANALYZE_IMAGE_TO_CODE_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Analyze a local image and return code based on the instruction.',
  properties: {
    imagePath: {
      type: 'string',
      description: 'Path to a local image file to analyze.',
    },
    instruction: {
      type: 'string',
      description:
        'Instruction for the model (for example, “Turn this screenshot into a React component.”).',
    },
  },
  required: ['imagePath', 'instruction'],
  additionalProperties: false,
}

/**
 * Tool: generate_image
 * Input: { prompt: string, imagePath?: string, model?: string, outputDir?: string, responseMimeType?: string }
 * Output: { ok: true, value: { files, model, createdAt, prompt, sourceImagePath? } }
 *   | { ok: false, error: { code, message, details: { prompt, imagePath?, model? } } }
 * Errors: INVALID_PROMPT, MISSING_API_KEY, INVALID_IMAGE_PATH, UNSUPPORTED_IMAGE_TYPE,
 *   IMAGE_READ_FAILED, NO_IMAGE_DATA, IO_ERROR, API_ERROR, UNKNOWN
 * Env: GEMINI_API_KEY (required when apiKey not provided).
 * Example input: { "prompt": "A snowy cabin" }
 * Example output: { "ok": true, "value": { "files": [{ "path": "...", "mimeType": "image/png", "extension": "png", "bytes": 123 }], "model": "gemini-2.0-flash-exp", "createdAt": "...", "prompt": "A snowy cabin" } }
 */
const GENERATE_IMAGE_TOOL: AgentTool = {
  name: 'generate_image',
  description: 'Generate an image and persist it to disk.',
  inputSchema: GENERATE_IMAGE_SCHEMA,
  execute: async (input: unknown) => {
    const record = asRecord(input)
    const prompt = getString(record, 'prompt') ?? ''
    const options: GenerateImageOptions = {}
    const imagePath = getString(record, 'imagePath')
    if (imagePath) {
      options.imagePath = imagePath
    }
    const model = getString(record, 'model')
    if (model) {
      options.model = model
    }
    const outputDir = getString(record, 'outputDir')
    if (outputDir) {
      options.outputDir = outputDir
    }
    const responseMimeType = getString(record, 'responseMimeType')
    if (responseMimeType) {
      options.responseMimeType = responseMimeType
    }

    return await generateImage(prompt, options)
  },
}

/**
 * Tool: analyze_image_to_code
 * Input: { imagePath: string, instruction: string }
 * Output: { ok: true, value: { text, model, imagePath, instruction } }
 *   | { ok: false, error: { code, message, details: { instruction, imagePath, model? } } }
 * Errors: INVALID_INSTRUCTION, INVALID_IMAGE_PATH, UNSUPPORTED_IMAGE_TYPE, IMAGE_READ_FAILED,
 *   MISSING_API_KEY, API_ERROR, NO_TEXT, UNKNOWN
 * Env: GEMINI_API_KEY
 * Example input: { "imagePath": "./login.png", "instruction": "Turn this screenshot into a React component." }
 * Example output: { "ok": true, "value": { "text": "// React code...", "model": "gemini-2.0-flash", "imagePath": "./login.png", "instruction": "..." } }
 */
export const visionAnalysisTool: AgentTool = {
  name: 'analyze_image_to_code',
  description: 'Analyze a local image and return code per the instruction.',
  inputSchema: ANALYZE_IMAGE_TO_CODE_SCHEMA,
  execute: async (input: unknown) => {
    const record = asRecord(input)
    const imagePath = getString(record, 'imagePath') ?? ''
    const instruction = getString(record, 'instruction') ?? ''
    return await analyzeImageToCode(imagePath, instruction)
  },
}

export const visionTools: AgentTool[] = [GENERATE_IMAGE_TOOL, visionAnalysisTool]

type InlineImage = {
  data: string
  mimeType: string
}

type ContentPart = { text: string } | { inlineData: InlineImage }

type GenerateContentRequest = {
  contents: Array<{ role: 'user'; parts: ContentPart[] }>
}

type GenerativeAiModel = {
  generateContent: (request: GenerateContentRequest) => Promise<{ response: unknown }>
}

type GenerativeAiClient = {
  getGenerativeModel: (options: { model: string }) => GenerativeAiModel
}

type InputImage = {
  base64: string
  mimeType: string
  buffer: Buffer
}

const DEFAULT_ANALYSIS_MODEL = 'gemini-2.0-flash'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export const analyzeImageToCode = async (
  imagePath: string,
  instruction: string,
): Promise<AnalyzeImageToCodeResponse> => {
  const trimmedInstruction = instruction.trim()
  if (!trimmedInstruction) {
    return buildAnalyzeError('INVALID_INSTRUCTION', 'Instruction must not be empty.', instruction)
  }

  const imageResult = await loadInputImage(imagePath)
  if (!imageResult.ok) {
    return buildAnalyzeError(imageResult.code, imageResult.message, trimmedInstruction, {
      imagePath,
    })
  }

  const apiKeyResult = await resolveApiKey()
  if (!apiKeyResult.ok) {
    return buildAnalyzeError('MISSING_API_KEY', apiKeyResult.message, trimmedInstruction, {
      imagePath,
    })
  }

  const model = DEFAULT_ANALYSIS_MODEL
  const request: GenerateContentRequest = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: trimmedInstruction },
          { inlineData: { data: imageResult.value.base64, mimeType: imageResult.value.mimeType } },
        ],
      },
    ],
  }

  const client = createClient(apiKeyResult.apiKey)
  let response: unknown

  try {
    const modelClient = client.getGenerativeModel({ model })
    const result = await modelClient.generateContent(request)
    response = result.response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image analysis failed.'
    return buildAnalyzeError('API_ERROR', message, trimmedInstruction, {
      imagePath,
      model,
    })
  }

  const text = extractTextResponse(response)
  if (!text) {
    return buildAnalyzeError(
      'NO_TEXT',
      'The model response did not include text output.',
      trimmedInstruction,
      { imagePath, model },
    )
  }

  return {
    ok: true,
    value: {
      text,
      model,
      imagePath: imagePath.trim(),
      instruction: trimmedInstruction,
    },
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

const getString = (record: Record<string, unknown> | null, key: string): string | undefined => {
  if (!record) {
    return undefined
  }
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

const createClient = (apiKey: string): GenerativeAiClient => {
  return new GoogleGenerativeAI(apiKey)
}

const resolveApiKey = async (): Promise<
  { ok: true; apiKey: string } | { ok: false; message: string }
> => {
  try {
    const credentials = await resolveGeminiCredentials()
    return { ok: true, apiKey: credentials.apiKey }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Gemini credentials.'
    return { ok: false, message }
  }
}

const loadInputImage = async (
  imagePath: string,
): Promise<
  | { ok: true; value: InputImage }
  | { ok: false; code: AnalyzeImageToCodeErrorCode; message: string }
> => {
  const trimmed = imagePath.trim()
  if (!trimmed) {
    return { ok: false, code: 'INVALID_IMAGE_PATH', message: 'Image path must not be empty.' }
  }

  const mimeType = inferImageMimeType(trimmed)
  if (!mimeType) {
    return {
      ok: false,
      code: 'UNSUPPORTED_IMAGE_TYPE',
      message: `Unsupported image type for ${trimmed}.`,
    }
  }

  let buffer: Buffer
  try {
    buffer = await fs.readFile(trimmed)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read input image.'
    return { ok: false, code: 'IMAGE_READ_FAILED', message }
  }

  return {
    ok: true,
    value: {
      base64: buffer.toString('base64'),
      mimeType,
      buffer,
    },
  }
}

const inferImageMimeType = (filePath: string): string | null => {
  const ext = path.extname(filePath).toLowerCase()
  return IMAGE_MIME_TYPES[ext] ?? null
}

const extractTextResponse = (response: unknown): string | null => {
  if (isRecord(response)) {
    const textValue = response.text
    if (typeof textValue === 'function') {
      try {
        const textResult = textValue.call(response)
        if (typeof textResult === 'string' && textResult.trim()) {
          return textResult.trim()
        }
      } catch {
        // Ignore and fall back to manual parsing.
      }
    }
  }

  if (!isRecord(response)) {
    return null
  }

  const candidatesValue = response.candidates
  if (!Array.isArray(candidatesValue)) {
    return null
  }

  const parts: string[] = []
  for (const candidate of candidatesValue) {
    if (!isRecord(candidate)) {
      continue
    }
    const content = candidate.content
    if (!isRecord(content)) {
      continue
    }
    const partsValue = content.parts
    if (!Array.isArray(partsValue)) {
      continue
    }
    for (const part of partsValue) {
      if (!isRecord(part)) {
        continue
      }
      const text = part.text
      if (typeof text === 'string' && text.trim()) {
        parts.push(text.trim())
      }
    }
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join('\n')
}

const buildAnalyzeError = (
  code: AnalyzeImageToCodeErrorCode,
  message: string,
  instruction: string,
  details?: { imagePath?: string; model?: string },
): AnalyzeImageToCodeError => {
  const trimmedInstruction = instruction.trim()
  return {
    ok: false,
    error: {
      code,
      message,
      details: {
        ...(trimmedInstruction ? { instruction: trimmedInstruction } : {}),
        ...(details?.imagePath ? { imagePath: details.imagePath } : {}),
        ...(details?.model ? { model: details.model } : {}),
      },
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
