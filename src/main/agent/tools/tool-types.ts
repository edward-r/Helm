import type { JsonSchema } from '@prompt-maker/core'

export type AgentTool = {
  name: string
  description: string
  inputSchema: JsonSchema
  execute: (input: unknown) => Promise<unknown>
}
