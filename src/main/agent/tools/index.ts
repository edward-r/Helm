import type { AgentTool } from './tool-types'
import { browserTools } from './browser'
import { fsTools } from './fs'
import { lspTools } from './lsp-tools'
import { visionTools } from './vision'

export { browserTools } from './browser'
export { visionAnalysisTool, visionTools } from './vision'
export { fsTools } from './fs'
export { lspTools } from './lsp-tools'
export type { AgentTool } from './tool-types'

export const ALL_TOOLS: AgentTool[] = [...browserTools, ...visionTools, ...fsTools, ...lspTools]
