import type { AnalyzeImageToCodeResponse } from './vision'
import { analyzeImageToCode } from './vision'
import type { GenerateImageOptions, GenerateImageResponse } from './generate-image'
import { generateImage } from './generate-image'
import type { ReadWebPageResponse, SearchWebResponse } from './browser'
import { readWebPage, searchWeb } from './browser'
import type { LspDocumentSymbolsInput, LspPositionInput, LspToolResponse } from './lsp-tools'
import { lsp_document_symbols, lsp_find_references, lsp_go_to_definition } from './lsp-tools'
import type {
  ListDirInput,
  ListDirResult,
  ReadFileInput,
  ReadFileResult,
  WriteFileInput,
  WriteFileResult
} from './fs'
import { list_dir, read_file, write_file } from './fs'

export const TOOL_NAMES = [
  'search_web',
  'read_web_page',
  'generate_image',
  'analyze_image_to_code',
  'read_file',
  'list_dir',
  'write_file',
  'lsp_go_to_definition',
  'lsp_find_references',
  'lsp_document_symbols'
] as const

export const PERSONA_TOOLS = {
  builder: [
    'read_file',
    'write_file',
    'execute_command',
    'search_web',
    'read_web_page',
    'lsp_document_symbols',
    'lsp_find_references',
    'lsp_go_to_definition'
  ],
  architect: [
    'read_file',
    'search_web',
    'read_web_page',
    'lsp_document_symbols',
    'lsp_find_references',
    'lsp_go_to_definition'
  ],
  researcher: ['search_web', 'read_web_page', 'read_file'],
  designer: ['read_file', 'write_file'],
  learner: [
    'read_file',
    'search_web',
    'read_web_page',
    'lsp_document_symbols',
    'lsp_find_references',
    'lsp_go_to_definition'
  ]
} as const

export type Persona = keyof typeof PERSONA_TOOLS

export type ToolName = (typeof TOOL_NAMES)[number]

export type ToolDispatchRequest =
  | { name: 'search_web'; arguments: { query: string } }
  | { name: 'read_web_page'; arguments: { url: string } }
  | {
      name: 'generate_image'
      arguments: {
        prompt: string
        imagePath?: string
        model?: string
        outputDir?: string
        responseMimeType?: string
      }
    }
  | {
      name: 'analyze_image_to_code'
      arguments: {
        imagePath: string
        instruction: string
      }
    }
  | { name: 'read_file'; arguments: ReadFileInput }
  | { name: 'list_dir'; arguments: ListDirInput }
  | { name: 'write_file'; arguments: WriteFileInput }
  | { name: 'lsp_go_to_definition'; arguments: LspPositionInput }
  | { name: 'lsp_find_references'; arguments: LspPositionInput }
  | { name: 'lsp_document_symbols'; arguments: LspDocumentSymbolsInput }

export type ToolDispatchResponse =
  | { name: 'search_web'; result: SearchWebResponse }
  | { name: 'read_web_page'; result: ReadWebPageResponse }
  | { name: 'generate_image'; result: GenerateImageResponse }
  | { name: 'analyze_image_to_code'; result: AnalyzeImageToCodeResponse }
  | { name: 'read_file'; result: ReadFileResult }
  | { name: 'list_dir'; result: ListDirResult }
  | { name: 'write_file'; result: WriteFileResult }
  | { name: 'lsp_go_to_definition'; result: LspToolResponse }
  | { name: 'lsp_find_references'; result: LspToolResponse }
  | { name: 'lsp_document_symbols'; result: LspToolResponse }

export const dispatchTool = async (request: ToolDispatchRequest): Promise<ToolDispatchResponse> => {
  switch (request.name) {
    case 'search_web': {
      const result = await searchWeb(request.arguments.query)
      return { name: request.name, result }
    }
    case 'read_web_page': {
      const result = await readWebPage(request.arguments.url)
      return { name: request.name, result }
    }
    case 'generate_image': {
      const { prompt, imagePath, model, outputDir, responseMimeType } = request.arguments
      const options: GenerateImageOptions = {}
      if (imagePath) {
        options.imagePath = imagePath
      }
      if (model) {
        options.model = model
      }
      if (outputDir) {
        options.outputDir = outputDir
      }
      if (responseMimeType) {
        options.responseMimeType = responseMimeType
      }
      const result = await generateImage(prompt, options)
      return { name: request.name, result }
    }
    case 'analyze_image_to_code': {
      const { imagePath, instruction } = request.arguments
      const result = await analyzeImageToCode(imagePath, instruction)
      return { name: request.name, result }
    }
    case 'read_file': {
      const result = await read_file(request.arguments)
      return { name: request.name, result }
    }
    case 'list_dir': {
      const result = await list_dir(request.arguments)
      return { name: request.name, result }
    }
    case 'write_file': {
      const result = await write_file(request.arguments)
      return { name: request.name, result }
    }
    case 'lsp_go_to_definition': {
      const result = await lsp_go_to_definition(request.arguments)
      return { name: request.name, result }
    }
    case 'lsp_find_references': {
      const result = await lsp_find_references(request.arguments)
      return { name: request.name, result }
    }
    case 'lsp_document_symbols': {
      const result = await lsp_document_symbols(request.arguments)
      return { name: request.name, result }
    }
  }
}
