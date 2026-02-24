import type { AnalyzeImageToCodeResponse } from './vision'
import { analyzeImageToCode } from './vision'
import type { GenerateImageOptions, GenerateImageResponse } from './generate-image'
import { generateImage } from './generate-image'
import type { ReadWebPageResponse, SearchWebResponse } from './browser'
import { readWebPage, searchWeb } from './browser'
import type {
  ListDirInput,
  ListDirResult,
  ReadFileInput,
  ReadFileResult,
  WriteFileInput,
  WriteFileResult,
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
] as const

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

export type ToolDispatchResponse =
  | { name: 'search_web'; result: SearchWebResponse }
  | { name: 'read_web_page'; result: ReadWebPageResponse }
  | { name: 'generate_image'; result: GenerateImageResponse }
  | { name: 'analyze_image_to_code'; result: AnalyzeImageToCodeResponse }
  | { name: 'read_file'; result: ReadFileResult }
  | { name: 'list_dir'; result: ListDirResult }
  | { name: 'write_file'; result: WriteFileResult }

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
  }
}
