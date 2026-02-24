import type { AgentTool } from './tool-types'
import { browserTools } from './browser'
import { fsTools } from './fs'
import { visionTools } from './vision'

export { browserTools } from './browser'
export { visionAnalysisTool, visionTools } from './vision'
export { fsTools } from './fs'
export type { AgentTool } from './tool-types'

export const ALL_TOOLS: AgentTool[] = [...browserTools, ...visionTools, ...fsTools]
