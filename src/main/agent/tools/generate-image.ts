import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { GoogleGenerativeAI } from '@google/generative-ai'

import { resolveGeminiCredentials } from '../../config'

export type GeneratedImageFile = {
  path: string
  mimeType: string
  extension: string
  bytes: number
}

export type GenerateImageSuccess = {
  ok: true
  value: {
    files: GeneratedImageFile[]
    model: string
    createdAt: string
    prompt: string
    sourceImagePath?: string
  }
}

export type GenerateImageErrorCode =
  | 'INVALID_PROMPT'
  | 'MISSING_API_KEY'
  | 'INVALID_IMAGE_PATH'
  | 'UNSUPPORTED_IMAGE_TYPE'
  | 'IMAGE_READ_FAILED'
  | 'NO_IMAGE_DATA'
  | 'IO_ERROR'
  | 'API_ERROR'
  | 'UNKNOWN'

export type GenerateImageError = {
  ok: false
  error: {
    code: GenerateImageErrorCode
    message: string
    details: {
      prompt: string
      imagePath?: string
      model?: string
    }
  }
}

export type GenerateImageResponse = GenerateImageSuccess | GenerateImageError

export type GenerateImageOptions = {
  model?: string
  outputDir?: string
  imagePath?: string
  responseMimeType?: string
  apiKey?: string
  client?: GenerativeAiClient
  now?: () => number
}

type InlineImage = {
  data: string
  mimeType: string
}

type ContentPart = { text: string } | { inlineData: InlineImage }

type GenerateContentRequest = {
  contents: Array<{ role: 'user'; parts: ContentPart[] }>
  generationConfig?: {
    responseMimeType?: string
  }
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

const DEFAULT_OUTPUT_DIR = 'generated/images'
const DEFAULT_IMAGE_MODEL = 'gemini-2.0-flash-exp'
const DEFAULT_RESPONSE_MIME_TYPE = 'image/png'

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const generateImage = async (
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResponse> => {
  const trimmed = prompt.trim()
  if (!trimmed) {
    return buildError('INVALID_PROMPT', 'Prompt must not be empty.', prompt)
  }

  const apiKeyResult = await resolveApiKey(options?.apiKey)
  if (!apiKeyResult.ok) {
    return buildError('MISSING_API_KEY', apiKeyResult.message, trimmed)
  }

  const model = options?.model?.trim() || DEFAULT_IMAGE_MODEL
  const now = options?.now ?? Date.now
  const nowMs = now()
  const createdAt = new Date(nowMs).toISOString()
  const outputDir = resolveOutputDir(options?.outputDir)
  const responseMimeType = normalizeResponseMimeType(options?.responseMimeType)

  let inputImage: InputImage | null = null
  if (options?.imagePath) {
    const imageResult = await loadInputImage(options.imagePath)
    if (!imageResult.ok) {
      return buildError(imageResult.code, imageResult.message, trimmed, {
        imagePath: options.imagePath,
        model,
      })
    }
    inputImage = imageResult.value
  }

  const parts: ContentPart[] = [{ text: trimmed }]
  if (inputImage) {
    parts.push({ inlineData: { data: inputImage.base64, mimeType: inputImage.mimeType } })
  }

  const request: GenerateContentRequest = {
    contents: [{ role: 'user', parts }],
    ...(responseMimeType ? { generationConfig: { responseMimeType } } : {}),
  }

  const client = options?.client ?? createClient(apiKeyResult.apiKey)
  let response: unknown

  try {
    const modelClient = client.getGenerativeModel({ model })
    const result = await modelClient.generateContent(request)
    response = result.response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Image generation failed.'
    return buildError('API_ERROR', message, trimmed, buildDetailExtras(options?.imagePath, model))
  }

  const images = extractInlineImages(response)
  if (images.length === 0) {
    return buildError(
      'NO_IMAGE_DATA',
      'The model response did not include image data. Try another model or prompt.',
      trimmed,
      buildDetailExtras(options?.imagePath, model),
    )
  }

  const baseName = buildBaseName(trimmed, inputImage?.buffer ?? null, nowMs)

  try {
    await fs.mkdir(outputDir, { recursive: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create output directory.'
    return buildError('IO_ERROR', message, trimmed, buildDetailExtras(options?.imagePath, model))
  }

  const files: GeneratedImageFile[] = []

  for (const [index, image] of images.entries()) {
    const buffer = decodeInlineImage(image)
    if (!buffer) {
      return buildError(
        'NO_IMAGE_DATA',
        'The model response included invalid image data.',
        trimmed,
        buildDetailExtras(options?.imagePath, model),
      )
    }

    const mimeType = image.mimeType || responseMimeType || DEFAULT_RESPONSE_MIME_TYPE
    const extension = extensionFromMimeType(mimeType)
    const indexedBase = images.length > 1 ? `${baseName}-${index + 1}` : baseName
    const targetPath = await resolveUniquePath(path.join(outputDir, `${indexedBase}.${extension}`))

    try {
      await fs.writeFile(targetPath, buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to write image file.'
      return buildError('IO_ERROR', message, trimmed, buildDetailExtras(options?.imagePath, model))
    }

    files.push({ path: targetPath, mimeType, extension, bytes: buffer.length })
  }

  const value: GenerateImageSuccess['value'] = {
    files,
    model,
    createdAt,
    prompt: trimmed,
  }

  if (options?.imagePath) {
    value.sourceImagePath = options.imagePath
  }

  return { ok: true, value }
}

const resolveApiKey = async (
  override?: string,
): Promise<{ ok: true; apiKey: string } | { ok: false; message: string }> => {
  const trimmed = override?.trim()
  if (trimmed) {
    return { ok: true, apiKey: trimmed }
  }

  try {
    const credentials = await resolveGeminiCredentials()
    return { ok: true, apiKey: credentials.apiKey }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Missing Gemini credentials.'
    return { ok: false, message }
  }
}

const createClient = (apiKey: string): GenerativeAiClient => {
  return new GoogleGenerativeAI(apiKey)
}

const resolveOutputDir = (override?: string): string => {
  const trimmed = override?.trim()
  if (!trimmed) {
    return path.resolve(process.cwd(), DEFAULT_OUTPUT_DIR)
  }
  return path.resolve(process.cwd(), trimmed)
}

const normalizeResponseMimeType = (value?: string): string | undefined => {
  const trimmed = value?.trim()
  if (trimmed) {
    return trimmed
  }
  return DEFAULT_RESPONSE_MIME_TYPE
}

const loadInputImage = async (
  imagePath: string,
): Promise<
  { ok: true; value: InputImage } | { ok: false; code: GenerateImageErrorCode; message: string }
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

const extractInlineImages = (response: unknown): InlineImage[] => {
  if (!isRecord(response)) {
    return []
  }

  const candidatesValue = response.candidates
  if (!Array.isArray(candidatesValue)) {
    return []
  }

  const images: InlineImage[] = []
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
      const inlineData = part.inlineData
      if (!isRecord(inlineData)) {
        continue
      }
      const data = inlineData.data
      const mimeType = inlineData.mimeType
      if (typeof data === 'string' && typeof mimeType === 'string') {
        images.push({ data, mimeType })
      }
    }
  }

  return images
}

const decodeInlineImage = (image: InlineImage): Buffer | null => {
  try {
    const buffer = Buffer.from(image.data, 'base64')
    if (buffer.length === 0) {
      return null
    }
    return buffer
  } catch {
    return null
  }
}

const buildBaseName = (prompt: string, imageBuffer: Buffer | null, nowMs: number): string => {
  const slug = slugify(prompt, 36)
  if (imageBuffer) {
    const hash = createHash('sha256').update(prompt).update(imageBuffer).digest('hex').slice(0, 12)
    return slug ? `image-${hash}-${slug}` : `image-${hash}`
  }

  const timestamp = formatTimestamp(new Date(nowMs))
  return slug ? `image-${timestamp}-${slug}` : `image-${timestamp}`
}

const formatTimestamp = (date: Date): string => {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

const slugify = (value: string, maxLength: number): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) {
    return ''
  }
  return slug.length > maxLength ? slug.slice(0, maxLength) : slug
}

const extensionFromMimeType = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase()
  return IMAGE_EXTENSIONS[normalized] ?? 'bin'
}

const resolveUniquePath = async (targetPath: string): Promise<string> => {
  if (!(await fileExists(targetPath))) {
    return targetPath
  }

  const { dir, name, ext } = path.parse(targetPath)
  let attempt = 1

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, `${name}-${attempt}${ext}`)
    if (!(await fileExists(candidate))) {
      return candidate
    }
    attempt += 1
  }
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.stat(filePath)
    return true
  } catch (error) {
    if (isFileMissingError(error)) {
      return false
    }
    throw error
  }
}

const isFileMissingError = (error: unknown): boolean => {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { code: string }).code === 'ENOENT'
  )
}

const buildError = (
  code: GenerateImageErrorCode,
  message: string,
  prompt: string,
  details?: { imagePath?: string; model?: string },
): GenerateImageError => {
  return {
    ok: false,
    error: {
      code,
      message,
      details: {
        prompt,
        ...(details?.imagePath ? { imagePath: details.imagePath } : {}),
        ...(details?.model ? { model: details.model } : {}),
      },
    },
  }
}

const buildDetailExtras = (
  imagePath?: string,
  model?: string,
): { imagePath?: string; model?: string } | undefined => {
  const details: { imagePath?: string; model?: string } = {}
  if (imagePath) {
    details.imagePath = imagePath
  }
  if (model) {
    details.model = model
  }
  return Object.keys(details).length > 0 ? details : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
