/* eslint-disable no-control-regex */
import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const PDF_MAX_PAGES_ENV = 'PROMPT_MAKER_PDF_MAX_PAGES'
const PDF_MAX_TEXT_CHARS_ENV = 'PROMPT_MAKER_PDF_MAX_TEXT_CHARS'
const PDF_MAX_STREAMS_ENV = 'PROMPT_MAKER_PDF_MAX_STREAMS'
const DEFAULT_PDF_MAX_PAGES = 30
const DEFAULT_PDF_MAX_TEXT_CHARS = 200_000
const DEFAULT_PDF_MAX_STREAMS = 200

const parsePositiveIntegerEnv = (key: string, fallback: number): number => {
  const raw = process.env[key]
  if (!raw) return fallback

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export type PdfExtractResult = { ok: true; text: string } | { ok: false; message: string }

type ParsedPdfString = { bytes: Uint8Array; nextIndex: number }

type PdfJsLoadingTask = { promise: Promise<unknown> }

type PdfJsModule = {
  getDocument: (options: unknown) => PdfJsLoadingTask
}

type PdfJsDocument = {
  numPages: number
  getPage: (pageNumber: number) => Promise<unknown>
}

type PdfJsPage = {
  getTextContent: () => Promise<unknown>
}

type PdfJsTextItem = { str?: unknown } & Record<string, unknown>

type PdfJsTextContent = {
  items?: unknown
}

const isPdfJsModule = (value: unknown): value is PdfJsModule => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const maybe = value as { getDocument?: unknown }
  return typeof maybe.getDocument === 'function'
}

const isPdfJsDocument = (value: unknown): value is PdfJsDocument => {
  if (!value || typeof value !== 'object') return false
  const maybe = value as { numPages?: unknown; getPage?: unknown }
  return typeof maybe.numPages === 'number' && typeof maybe.getPage === 'function'
}

const isPdfJsPage = (value: unknown): value is PdfJsPage => {
  if (!value || typeof value !== 'object') return false
  return typeof (value as { getTextContent?: unknown }).getTextContent === 'function'
}

const isPdfJsTextContent = (value: unknown): value is PdfJsTextContent => {
  return Boolean(value) && typeof value === 'object'
}

const loadPdfJs = async (): Promise<PdfJsModule | null> => {
  try {
    const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown
    return isPdfJsModule(mod) ? mod : null
  } catch {
    return null
  }
}

const normalizeExtractedText = (value: string): string => {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const extractPdfTextWithPdfJs = async (filePath: string): Promise<PdfExtractResult> => {
  const pdfjs = await loadPdfJs()
  if (!pdfjs) {
    return { ok: false, message: 'PDF text extraction library is unavailable.' }
  }

  const maxPages = parsePositiveIntegerEnv(PDF_MAX_PAGES_ENV, DEFAULT_PDF_MAX_PAGES)
  const maxChars = parsePositiveIntegerEnv(PDF_MAX_TEXT_CHARS_ENV, DEFAULT_PDF_MAX_TEXT_CHARS)

  let buffer: Buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Unable to read PDF ${filePath}: ${message}` }
  }

  try {
    const bytes = new Uint8Array(buffer)
    const task = pdfjs.getDocument({ data: bytes, disableWorker: true })
    const doc = await task.promise

    if (!isPdfJsDocument(doc)) {
      return { ok: false, message: `PDF parser returned an unexpected document for ${filePath}.` }
    }

    const pageCount = Math.max(0, Math.min(doc.numPages, maxPages))

    const chunks: string[] = []
    let charsSoFar = 0

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      if (!isPdfJsPage(page)) {
        continue
      }

      const textContent = await page.getTextContent()
      if (!isPdfJsTextContent(textContent)) {
        continue
      }

      const items = (textContent as PdfJsTextContent).items
      if (!Array.isArray(items)) {
        continue
      }

      const pageStrings = items
        .map((item) => {
          const str = (item as PdfJsTextItem).str
          return typeof str === 'string' ? str : ''
        })
        .filter((value) => value.length > 0)

      const pageText = normalizeExtractedText(pageStrings.join(' '))
      if (!pageText) {
        continue
      }

      chunks.push(pageText)
      charsSoFar += pageText.length + 1
      if (charsSoFar >= maxChars) {
        break
      }
    }

    const merged = normalizeExtractedText(chunks.join('\n'))
    if (!merged) {
      return {
        ok: false,
        message:
          'Unable to extract text from PDF. If this is a scanned PDF, convert it to searchable text (OCR) or use a Gemini model for native PDF input.',
      }
    }

    return { ok: true, text: merged.slice(0, maxChars) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Failed to parse PDF ${filePath}: ${message}` }
  }
}

const isWhitespaceByte = (byte: number): boolean => {
  return byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20
}

const decodeUtf16Be = (bytes: Uint8Array): string => {
  const length = bytes.length
  const start = length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff ? 2 : 0

  const codeUnits: number[] = []
  for (let i = start; i + 1 < length; i += 2) {
    const high = bytes[i] ?? 0
    const low = bytes[i + 1] ?? 0
    codeUnits.push((high << 8) | low)
  }

  return String.fromCharCode(...codeUnits)
}

const decodePdfStringBytes = (bytes: Uint8Array): string => {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeUtf16Be(bytes)
  }

  return Buffer.from(bytes).toString('latin1')
}

const readPdfLiteralString = (data: string, startIndex: number): ParsedPdfString | null => {
  if (data[startIndex] !== '(') return null

  const bytes: number[] = []
  let depth = 1
  let i = startIndex + 1

  while (i < data.length) {
    const ch = data[i]
    if (ch === undefined) break

    if (ch === '\\') {
      const next = data[i + 1]
      if (next === undefined) {
        i += 1
        continue
      }

      if (next === '\n') {
        i += 2
        continue
      }
      if (next === '\r') {
        if (data[i + 2] === '\n') {
          i += 3
        } else {
          i += 2
        }
        continue
      }

      const octalMatch = data.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)
      if (octalMatch) {
        bytes.push(Number.parseInt(octalMatch[0], 8))
        i += 1 + octalMatch[0].length
        continue
      }

      const mapped =
        next === 'n'
          ? 0x0a
          : next === 'r'
            ? 0x0d
            : next === 't'
              ? 0x09
              : next === 'b'
                ? 0x08
                : next === 'f'
                  ? 0x0c
                  : next.charCodeAt(0)

      bytes.push(mapped)
      i += 2
      continue
    }

    if (ch === '(') {
      depth += 1
      bytes.push(ch.charCodeAt(0))
      i += 1
      continue
    }

    if (ch === ')') {
      depth -= 1
      if (depth === 0) {
        return { bytes: Uint8Array.from(bytes), nextIndex: i + 1 }
      }
      bytes.push(ch.charCodeAt(0))
      i += 1
      continue
    }

    bytes.push(ch.charCodeAt(0))
    i += 1
  }

  return null
}

const readPdfHexString = (data: string, startIndex: number): ParsedPdfString | null => {
  if (data[startIndex] !== '<') return null
  if (data[startIndex + 1] === '<') return null

  let i = startIndex + 1
  const hexChars: string[] = []

  while (i < data.length) {
    const ch = data[i]
    if (ch === undefined) break
    if (ch === '>') {
      i += 1
      break
    }
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f') {
      i += 1
      continue
    }
    hexChars.push(ch)
    i += 1
  }

  const hex = hexChars.join('')
  if (hex.length === 0) return null

  const normalized = hex.length % 2 === 1 ? `${hex}0` : hex
  const bytes: number[] = []

  for (let idx = 0; idx + 1 < normalized.length; idx += 2) {
    const byte = Number.parseInt(normalized.slice(idx, idx + 2), 16)
    if (!Number.isFinite(byte)) {
      return null
    }
    bytes.push(byte)
  }

  return { bytes: Uint8Array.from(bytes), nextIndex: i }
}

const readOperator = (data: string, startIndex: number): { op: string; nextIndex: number } => {
  let i = startIndex
  while (i < data.length) {
    const byte = data.charCodeAt(i)
    if (!isWhitespaceByte(byte)) break
    i += 1
  }

  const ch = data[i]
  if (ch === undefined) {
    return { op: '', nextIndex: i }
  }

  if (ch === "'" || ch === '"') {
    return { op: ch, nextIndex: i + 1 }
  }

  let end = i
  while (end < data.length) {
    const b = data.charCodeAt(end)
    const isAlpha = (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a)
    if (!isAlpha) break
    end += 1
  }

  return { op: data.slice(i, end), nextIndex: end }
}

const extractTextFromContentStream = (data: string): string[] => {
  const out: string[] = []

  let i = 0
  while (i < data.length) {
    const ch = data[i]

    if (ch === '(') {
      const parsed = readPdfLiteralString(data, i)
      if (!parsed) {
        i += 1
        continue
      }

      const { op, nextIndex } = readOperator(data, parsed.nextIndex)
      if (op === 'Tj' || op === "'" || op === '"') {
        const text = normalizeExtractedText(decodePdfStringBytes(parsed.bytes))
        if (text) out.push(text)
        i = nextIndex
        continue
      }

      i = parsed.nextIndex
      continue
    }

    if (ch === '[') {
      const pieces: string[] = []
      i += 1

      while (i < data.length && data[i] !== ']') {
        const inner = data[i]
        if (inner === '(') {
          const parsed = readPdfLiteralString(data, i)
          if (!parsed) {
            i += 1
            continue
          }
          const text = normalizeExtractedText(decodePdfStringBytes(parsed.bytes))
          if (text) pieces.push(text)
          i = parsed.nextIndex
          continue
        }

        if (inner === '<') {
          const parsed = readPdfHexString(data, i)
          if (!parsed) {
            i += 1
            continue
          }
          const text = normalizeExtractedText(decodePdfStringBytes(parsed.bytes))
          if (text) pieces.push(text)
          i = parsed.nextIndex
          continue
        }

        i += 1
      }

      if (data[i] === ']') {
        const { op, nextIndex } = readOperator(data, i + 1)
        if (op === 'TJ') {
          const combined = normalizeExtractedText(pieces.join(' '))
          if (combined) out.push(combined)
          i = nextIndex
          continue
        }
      }

      i += 1
      continue
    }

    i += 1
  }

  return out
}

const extractPdfTextFromBuffer = (buffer: Buffer): PdfExtractResult => {
  const maxStreams = parsePositiveIntegerEnv(PDF_MAX_STREAMS_ENV, DEFAULT_PDF_MAX_STREAMS)
  const maxChars = parsePositiveIntegerEnv(PDF_MAX_TEXT_CHARS_ENV, DEFAULT_PDF_MAX_TEXT_CHARS)

  const pieces: string[] = []

  let searchIndex = 0
  let streamsSeen = 0

  while (streamsSeen < maxStreams) {
    const streamIndex = buffer.indexOf('stream', searchIndex)
    if (streamIndex < 0) break

    streamsSeen += 1

    const dictStart = Math.max(0, streamIndex - 2048)
    const dictText = buffer.subarray(dictStart, streamIndex).toString('latin1')
    const isFlate = /\/FlateDecode\b/.test(dictText)

    let dataStart = streamIndex + 'stream'.length

    while (dataStart < buffer.length) {
      const byte = buffer[dataStart]
      if (byte === 0x0a) {
        dataStart += 1
        break
      }
      if (byte === 0x0d) {
        if (buffer[dataStart + 1] === 0x0a) {
          dataStart += 2
        } else {
          dataStart += 1
        }
        break
      }
      if (byte === 0x20 || byte === 0x09) {
        dataStart += 1
        continue
      }
      break
    }

    const endIndex = buffer.indexOf('endstream', dataStart)
    if (endIndex < 0) break

    const rawStream = buffer.subarray(dataStart, endIndex)

    let contentBytes: Buffer = rawStream
    if (isFlate) {
      try {
        contentBytes = inflateSync(rawStream)
      } catch {
        contentBytes = rawStream
      }
    }

    const streamText = contentBytes.toString('latin1')

    let lengthSoFar = pieces.reduce((sum, part) => sum + part.length + 1, 0)

    for (const extracted of extractTextFromContentStream(streamText)) {
      if (!extracted) {
        continue
      }

      pieces.push(extracted)
      lengthSoFar += extracted.length + 1
      if (lengthSoFar >= maxChars) {
        break
      }
    }

    if (lengthSoFar >= maxChars) {
      break
    }

    searchIndex = endIndex + 'endstream'.length
  }

  const merged = normalizeExtractedText(pieces.join('\n'))
  if (!merged) {
    return {
      ok: false,
      message:
        'Unable to extract text from PDF. If this is a scanned PDF, convert it to searchable text (OCR) or use a Gemini model for native PDF input.',
    }
  }

  return { ok: true, text: merged.slice(0, maxChars) }
}

export const extractPdfTextFromFile = async (filePath: string): Promise<PdfExtractResult> => {
  const pdfJsResult = await extractPdfTextWithPdfJs(filePath)
  if (pdfJsResult.ok) {
    return pdfJsResult
  }

  try {
    const buffer = await fs.readFile(filePath)
    return extractPdfTextFromBuffer(buffer)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `Unable to read PDF ${filePath}: ${message}` }
  }
}
