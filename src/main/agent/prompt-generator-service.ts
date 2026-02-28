import { callLLM } from '@prompt-maker/core'
import type { Message } from '@prompt-maker/core'

import { buildPromptEmissionXml } from './prompt-emission'

export const promptGeneratorService = {
  generateContract: async (options: {
    userIntent: string
    smartContextXml: string
    model: string
    useSeriesGeneration?: boolean
  }): Promise<string> => {
    const useSeriesGeneration = options.useSeriesGeneration === true
    const seriesInstruction = useSeriesGeneration
      ? '\n4. Provide 3 distinct variants labeled "Option 1", "Option 2", and "Option 3". Each option must include all required sections.\n'
      : ''
    const generatorPrompt = `You are an expert Prompt Engineer. Convert the user's raw intent into an optimized execution plan for an autonomous coding agent.

Requirements:
1. Start with a concise "# Title".
2. Include sections: "Role", "Context", "Goals & Tasks", "Inputs", "Constraints", "Execution Plan", "Output Format", "Quality Checks".
3. Do NOT execute the task - only craft instructions.${seriesInstruction}

User Intent:
${options.userIntent}

Output ONLY the final markdown prompt contract.`

    const messages: Message[] = [{ role: 'user', content: generatorPrompt }]
    const generatorResponse = await callLLM(messages, options.model)
    const generatedContract =
      typeof generatorResponse.content === 'string'
        ? generatorResponse.content.trim()
        : options.userIntent

    return buildPromptEmissionXml({
      prompt: generatedContract,
      documentContext: options.smartContextXml
    })
  }
}
